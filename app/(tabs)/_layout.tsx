import { Tabs } from 'expo-router';
import { Text, Image } from 'react-native';

const AppIcon = require('../../assets/Icon.png');

function TabIcon({ symbol }: { symbol: string }) {
  return <Text style={{ fontSize: 20 }}>{symbol}</Text>;
}

function AppIconTab() {
  return <Image source={AppIcon} style={{ width: 24, height: 24, borderRadius: 6 }} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0D0D0D',
          borderTopColor: '#2A2A2A',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: '#C9A84C',
        tabBarInactiveTintColor: '#555555',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: () => <AppIconTab />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Armory',
          tabBarIcon: () => <TabIcon symbol="🛡" />,
        }}
      />
      <Tabs.Screen
        name="range"
        options={{
          title: 'Range',
          tabBarIcon: () => <TabIcon symbol="🎯" />,
        }}
      />
      <Tabs.Screen
        name="supply"
        options={{
          title: 'Supply',
          tabBarIcon: () => <TabIcon symbol="📦" />,
        }}
      />
    </Tabs>
  );
}
