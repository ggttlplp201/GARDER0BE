import { useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import AuthScreen from './components/AuthScreen';
import Inventory from './components/Inventory';
import { enableGyro } from './lib/gyro';
import './App.css';

export default function App() {
  const { user, authMode, setAuthMode, signIn, signUp, signOut } = useAuth();

  // Enable gyroscope on first touch anywhere in the app (covers login + inventory)
  useEffect(() => {
    if (!('ontouchstart' in window)) return;
    document.addEventListener('touchstart', enableGyro, { once: true, passive: true });
    return () => document.removeEventListener('touchstart', enableGyro);
  }, []);

  if (user === undefined) return (
    <div className="app-loading">
      <span className="app-loading-text">GARDEROBE</span>
    </div>
  );

  if (!user) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        onLogin={signIn}
        onSignUp={signUp}
      />
    );
  }

  return <Inventory user={user} onSignOut={signOut} />;
}
