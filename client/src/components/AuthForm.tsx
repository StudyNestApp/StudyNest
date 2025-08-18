import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import ReactiveButton from 'reactive-button';
import GoogleButton from 'react-google-button';
import logo from './../assets/logo2.png'
import './../styles/AuthForm.css'; // <-- CSS file

interface AuthFormProps {
  onAuthSuccess?: () => void;
}

function AuthForm({ onAuthSuccess }: AuthFormProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && onAuthSuccess) onAuthSuccess();
    };
    checkUser();
  }, [onAuthSuccess]);

  const handleAuth = async () => {
    setState('loading');
    setErrorMsg('');

    const { error, data } = isLogin
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (error) {
      setState('error');
      setErrorMsg(error.message);
      return;
    }

    setState('success');

    if (!isLogin && !data.user?.email_confirmed_at) {
      setErrorMsg('Please check your email for verification link');
      setState('idle');
      return;
    }

    setTimeout(() => onAuthSuccess?.(), 1000);
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/welcome` },
    });
    if (error) {
      console.error('Google Sign-In Error:', error.message);
      setErrorMsg('Google sign-in failed. Please try again.');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <img src={logo} alt="StudyNest" className="logo" />
        <h2 className="title">{isLogin ? 'Login' : 'Register'}</h2>

        <div className="form-stack">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state === 'loading'}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={state === 'loading'}
          />

          {errorMsg && <p className="error">{errorMsg}</p>}

          <ReactiveButton
            buttonState={state}
            idleText={isLogin ? 'Login' : 'Register'}
            loadingText="Processing"
            successText="Success"
            errorText="Failed"
            onClick={handleAuth}
            disabled={state === 'loading'}
            className="primary-btn"
          />

          {/* GoogleButton has its own internal width; we center it and give breathing room */}
          <div className="google-btn-row">
            <GoogleButton
              onClick={handleGoogleLogin}
              disabled={state === 'loading'}
            />
          </div>

          <p className="switch-text">
            {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setErrorMsg('');
                setState('idle');
              }}
              disabled={state === 'loading'}
              className="switch-link"
              type="button"
            >
              {isLogin ? 'Register' : 'Login'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default AuthForm;