import { Tabs } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import {
  FocusTabIcon, TasksTabIcon, CalendarTabIcon, TimeTabIcon, ProfileTabIcon,
} from '../../components/TabIcons';

// Today is the landing tab, so it owns the group's index route — that is what
// makes a cold launch (and every bare `router.replace('/(tabs)')`) open on the
// day's plan. Focus keeps its own named route at /(tabs)/focus; anything that
// means "take me to the timer" must say so explicitly. The social feed is not a
// tab: it is the pushed /community screen, reached from You.
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
      {/* Order is deliberate: Today · Focus · Calendar · Time · You. Focus sits
          next to Today because starting a session is the next step from the
          plan; the tools that look back (Time) and the personal ones (You)
          come last. */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarAccessibilityLabel: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <TasksTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="focus"
        options={{
          title: 'Focus',
          tabBarAccessibilityLabel: 'Focus',
          tabBarIcon: ({ color, focused }) => (
            <FocusTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarAccessibilityLabel: 'Calendar',
          tabBarIcon: ({ color, focused }) => (
            <CalendarTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="time"
        options={{
          title: 'Time',
          tabBarAccessibilityLabel: 'Time',
          tabBarIcon: ({ color, focused }) => (
            <TimeTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'You',
          tabBarAccessibilityLabel: 'You',
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
