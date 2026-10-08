import { Tabs } from 'expo-router';

import { BottomNav, TopBar } from '@/components/app/Bars';
import { Backdrop } from '@/components/ui/primitives';
import { useApp } from '@/contexts/AppContext';

type NavLike = {
  getState: () => { history?: unknown[] };
  goBack: () => void;
  navigate: (name: string) => void;
};

function Header({ navigation }: { navigation: NavLike }) {
  const { me, openNotifications } = useApp();
  const history = navigation.getState()?.history ?? [];
  return (
    <TopBar
      canGoBack={history.length > 1}
      onBack={() => navigation.goBack()}
      onLive={() => navigation.navigate('live')}
      onBell={openNotifications}
      onAvatar={() => navigation.navigate('profile')}
      photo={me?.photo ?? null}
      name={me?.name ?? ''}
    />
  );
}

/**
 * Prototype MainApp shell: glass TopBar + glass BottomNav
 * (Home · Discover · Create · Matches · Messages). Profile, Live and Events
 * are reachable from the top bar / sections and keep both bars.
 */
export default function TabLayout() {
  return (
    <>
      <Backdrop />
      <Tabs
        backBehavior="history"
        initialRouteName="home"
        screenOptions={{
          headerTransparent: true,
          header: ({ navigation }) => <Header navigation={navigation as unknown as NavLike} />,
          sceneStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
        tabBar={({ state, navigation }) => (
          <BottomNav
            active={state.routes[state.index]?.name ?? 'home'}
            onTab={(key) => navigation.navigate(key)}
            onCreate={() => navigation.navigate('social')}
          />
        )}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="discover" />
        <Tabs.Screen name="social" />
        <Tabs.Screen name="matches" />
        <Tabs.Screen name="messages" />
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="live" options={{ href: null }} />
        <Tabs.Screen name="events" options={{ href: null }} />
      </Tabs>
    </>
  );
}
