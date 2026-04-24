import os
import re
from pathlib import Path
from typing import Dict, Iterable, Optional

_ENV_CACHE: Optional[Dict[str, str]] = None


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def _parse_env_file(path: Path) -> Dict[str, str]:
    """Parses a .env file.

    Supports both formats:
      KEY=value
      key = value   (python-ish assignments like your current file)

    Lines starting with # are ignored.
    """

    if not path.exists():
        return {}

    env: Dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        # KEY=value
        if "=" in line:
            left, right = line.split("=", 1)
            key = left.strip()
            value = right.strip()

            # Handle python-ish: api_id = 123 (remove spaces, optional trailing comments)
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()

            # If left side was like "api_id " (already stripped)
            # Drop optional leading "export "
            if key.startswith("export "):
                key = key[len("export ") :].strip()

            # If value was like "123" or "'abc'" or "354" keep unquoted
            env[key] = _strip_quotes(value)

    return env


def load_env(dotenv_path: str = ".env") -> Dict[str, str]:
    global _ENV_CACHE
    if _ENV_CACHE is not None:
        return _ENV_CACHE

    file_env = _parse_env_file(Path(dotenv_path))
    # Real environment variables should win over file.
    merged = {**file_env, **{k: v for k, v in os.environ.items() if v is not None}}
    _ENV_CACHE = merged
    return merged


def get_env(name: str, *, default: Optional[str] = None, fallback_names: Iterable[str] = ()) -> Optional[str]:
    env = load_env()
    if name in env and env[name] != "":
        return env[name]
    for alt in fallback_names:
        if alt in env and env[alt] != "":
            return env[alt]
    return default


def get_env_int(name: str, *, default: Optional[int] = None, fallback_names: Iterable[str] = ()) -> Optional[int]:
    raw = get_env(name, default=None, fallback_names=fallback_names)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"Invalid int for {name}: {raw!r}")
