import { Tabs } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import {
  AscendTabIcon, FocusTabIcon, TasksTabIcon, CalendarTabIcon, ProfileTabIcon,
} from '../../components/TabIcons';

// Ascend is the landing tab, so it owns the group's index route — that is what
// makes a cold launch (and every bare `router.replace('/(tabs)')`) open on the
// feed rather than the timer. Focus keeps its own named route at /(tabs)/focus;
// anything that means "take me to the timer" must say so explicitly.
export const unstable_settings = { initialRouteName: 'index' };

export default function TabLayout() {
  const Colors = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.bg,
          borderTopColor: Colors.border,
          borderTopWidth: 0.5,
          paddingTop: 8,
          paddingBottom: 8,
          height: 64,
          elevation: 0,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.subtext,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          letterSpacing: 0.5,
          marginTop: -2,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
      }}
    >
      {/* Order is deliberate: Ascend · Focus · Tasks · Calendar · Profile. Focus
          sits at position two — one tap from the landing screen — because this
          is a demotion in landing priority, not in reachability. */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ascend',
          tabBarIcon: ({ color, focused }) => (
            <AscendTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="focus"
        options={{
          title: 'Focus',
          tabBarIcon: ({ color, focused }) => (
            <FocusTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, focused }) => (
            <TasksTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ color, focused }) => (
            <CalendarTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <ProfileTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ href: null }}
      />
    </Tabs>
  );
}
