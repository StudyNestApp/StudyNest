import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import logo from '../assets/logo2.png';
import ReactiveButton from 'reactive-button';
import GoogleButton from 'react-google-button';
import bgImage from '../assets/bg-auth.png';


function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAuth = async () => {
    setState('loading');
    setErrorMsg('');

    const { error } = isLogin
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (error) {
      setState('error');
      setErrorMsg(error.message);
    } else {
      setState('success');
    }
  };

  return (
<div className="relative min-h-screen w-full overflow-clip flex items-start justify-center pt-20 px-4">
  <img
    src={bgImage}
    alt="Background"
    className="absolute inset-0 w-full h-full object-fill"
  />

  <div className="relative z-10 w-full max-w-md bg-transparent p-6 space-y-4">
    <img
      src={logo}
      alt="StudyNest Logo"
      className="w-48 h-auto mx-auto"
    />

    <h2 className="text-2xl font-bold text-center text-teal-800">
      {isLogin ? 'Login' : 'Register'}
    </h2>

    <input
      type="email"
      placeholder="Email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      className="w-full px-4 py-2 border rounded bg-white bg-opacity-80"
    />

    <input
      type="password"
      placeholder="Password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      className="w-full px-4 py-2 border rounded bg-white bg-opacity-80"
    />

    {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}

    <ReactiveButton
      buttonState={state}
      idleText={isLogin ? 'Login' : 'Register'}
      loadingText="Processing"
      successText="Success"
      errorText="Failed"
      onClick={handleAuth}
      color="teal"
      className="w-full"
    />

    <GoogleButton
      className="w-full"
      onClick={() => { console.log('Google button clicked') }}
    />

    <p className="text-sm text-center text-teal-800">
      {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
      <button
        onClick={() => setIsLogin(!isLogin)}
        className="text-blue-300 underline"
      >
        {isLogin ? 'Register' : 'Login'}
      </button>
    </p>
  </div>
</div>
);

}

export default AuthForm;
