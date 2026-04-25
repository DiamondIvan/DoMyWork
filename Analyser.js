const readline = require('readline');

const API_KEY = 'sk-b0ad8da654af17eb6c8cb5b1006be30c8ecb8c9e108dd875'; 
const BASE_URL = 'https://api.ilmu.ai/v1/chat/completions';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let systemDirective = "";

async function processWithDirective(userInput) {
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "ilmu-glm-5.1", 
      messages: [
        { 
          role: "system", 
          content: `You are a smart text message agent that will filter out information from text chat logs. You are supposed to extract important information from various chats.
                    Your target type of information is: ${systemDirective}. 
                    The logs will be formatted like "[None] Name says: message". There can be multiple texts at a time.
                    Format it in a another text message with a consistant format. Do not use emojis. Make sure the output message is as consice and accurate as possible.` 
        },
        { role: "user", content: userInput }
      ],
      stream: false
    })
  };

  try {
    const res = await fetch(BASE_URL, options);
    const data = await res.json();

    if (!res.ok) {
      console.log(`\nError: ${data.error?.message || 'Check balance'}`);
      return;
    }

    const result = data?.choices?.[0]?.message?.content;
    console.log(`${result?.trim()}`);
  } catch (err) {
    console.error("\nFailed:", err.message);
  }
}

// Step 1: Get the "Vibe" or Goal from the user
rl.question('What specific information should I focus on? : ', (directive) => {
  systemDirective = directive;
  console.log(`\nDirective Set: "${systemDirective}"`);
  console.log('--- Starting Input Loop (Type "exit" to quit) ---\n');

  // Step 2: Start the continuous input loop
  const loop = () => {
    rl.question('Enter message: ', async (input) => {
      if (input.toLowerCase() === 'exit') return rl.close();
      await processWithDirective(input);
      loop();
    });
  };
  loop();
});

function createCalendarEvent() {
  // 1. Get the default calendar
  var calendar = CalendarApp.getDefaultCalendar();
  
  // 2. Define event details
  var title = 'Project Sync';
  var startTime = new Date('April 25, 2026 10:00:00');
  var endTime = new Date('April 25, 2026 11:00:00');
  var options = {
    location: 'Conference Room A',
    description: 'Weekly sync to discuss project milestones.'
  };
  
  // 3. Create the event
  calendar.createEvent(title, startTime, endTime, options);
  Logger.log('Event created successfully.');
}
