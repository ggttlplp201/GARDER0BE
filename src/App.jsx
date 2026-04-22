import { useAuth } from './hooks/useAuth';
import AuthScreen from './components/AuthScreen';
import Inventory from './components/Inventory';
import './App.css';

export default function App() {
  const { user, authMode, setAuthMode, signIn, signUp, signOut } = useAuth();

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
