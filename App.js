import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { Image } from "react-native";
import { COLORS } from "./src/constants/theme";

import ChatScreen from "./src/screens/ChatScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import MenuScreen from "./src/screens/MenuScreen";
import SettingScreen from "./src/screens/SettingScreen";
import ToDoScreen from "./src/screens/ToDoScreen";

const Tab = createBottomTabNavigator();

const tabIcons = {
  Menu: require("./assets/homepage.png"),
  ToDo: require("./assets/todolist.png"),
  Chat: require("./assets/chatbot.png"),
  History: require("./assets/historychat.png"),
  Settings: require("./assets/settinglogo.png"),
};

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: COLORS.primary,
            height: 70,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            position: "absolute",
            borderTopWidth: 0,
          },
        }}
      >
        <Tab.Screen
          name="Menu"
          component={MenuScreen}
          options={{
            tabBarIcon: () => (
              <Image source={tabIcons.Menu} style={{ width: 22, height: 22 }} />
            ),
          }}
        />
        <Tab.Screen
          name="ToDo"
          component={ToDoScreen}
          options={{
            tabBarIcon: () => (
              <Image source={tabIcons.ToDo} style={{ width: 22, height: 22 }} />
            ),
          }}
        />
        <Tab.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            tabBarIcon: () => (
              <Image source={tabIcons.Chat} style={{ width: 22, height: 22 }} />
            ),
          }}
        />
        <Tab.Screen
          name="History"
          component={HistoryScreen}
          options={{
            tabBarIcon: () => (
              <Image
                source={tabIcons.History}
                style={{ width: 22, height: 22 }}
              />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingScreen}
          options={{
            tabBarIcon: () => (
              <Image
                source={tabIcons.Settings}
                style={{ width: 22, height: 22 }}
              />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
