import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Eye,
  EyeOff,
  Phone,
  Mail,
  Lock,
  User,
  MapPin,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Store,
  AlertCircle,
  X,
  Stethoscope
} from 'lucide-react';
import irisBg from '../assets/eyereach_iris_bg.jpg';
import './AuthPage.css';

// Elegant Natural Eye Care Logo for EyeReach (Forest Green & Sage Green Iris, Natural Pupil)
export function EyeReachLogo({ size = 48, className = "" }) {
  const id = React.useId();
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="EyeReach Natural Eye Care Logo"
    >
      <defs>
        {/* Natural Forest Green & Sage Green Radial Iris Gradient */}
        <radialGradient id={`iris-gradient-${id}`} cx="50%" cy="50%" r="50%" fx="44%" fy="44%">
          <stop offset="0%" stopColor="#74c69d" />       {/* Soft Sage Inner Glow */}
          <stop offset="35%" stopColor="#52b788" />      {/* Natural Sage Green */}
          <stop offset="68%" stopColor="#2d6a4f" />      {/* Rich Forest Green */}
          <stop offset="100%" stopColor="#1b4332" />     {/* Deep Forest Green Limbal Ring */}
        </radialGradient>

        {/* Eyelid Contour Gradient: Sage to Forest Green */}
        <linearGradient id={`eyelid-stroke-${id}`} x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#52b788" />
          <stop offset="50%" stopColor="#74c69d" />
          <stop offset="100%" stopColor="#2d6a4f" />
        </linearGradient>

        {/* Subtle sclera wash */}
        <radialGradient id={`sclera-fill-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.03" />
        </radialGradient>
      </defs>

      {/* 1. Natural Eye Sclera & Eyelid Outline */}
      <path 
        d="M 6 50 C 20 22, 80 22, 94 50 C 80 78, 20 78, 6 50 Z" 
        fill={`url(#sclera-fill-${id})`}
        stroke={`url(#eyelid-stroke-${id})`} 
        strokeWidth="4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />

      {/* 2. Iris Circle (Limbal Ring & Forest/Sage Green gradient) */}
      <circle 
        cx="50" 
        cy="50" 
        r="24" 
        fill={`url(#iris-gradient-${id})`}
        stroke="#1b4332"
        strokeWidth="1.6"
      />

      {/* 3. Delicate Natural Iris Pattern (Radiating crypts & collarette) */}
      <g stroke="#95d5b2" strokeWidth="0.85" opacity="0.45" strokeLinecap="round">
        <line x1="50" y1="27" x2="50" y2="34" />
        <line x1="50" y1="66" x2="50" y2="73" />
        <line x1="27" y1="50" x2="34" y2="50" />
        <line x1="66" y1="50" x2="73" y2="50" />
        <line x1="33.7" y1="33.7" x2="38.7" y2="38.7" />
        <line x1="61.3" y1="61.3" x2="66.3" y2="66.3" />
        <line x1="66.3" y1="33.7" x2="61.3" y2="38.7" />
        <line x1="38.7" y1="61.3" x2="33.7" y2="66.3" />
        <line x1="41.2" y1="28.5" x2="43.8" y2="34.5" />
        <line x1="58.8" y1="71.5" x2="56.2" y2="65.5" />
        <line x1="58.8" y1="28.5" x2="56.2" y2="34.5" />
        <line x1="41.2" y1="71.5" x2="43.8" y2="65.5" />
        <line x1="28.5" y1="41.2" x2="34.5" y2="43.8" />
        <line x1="71.5" y1="58.8" x2="65.5" y2="56.2" />
        <line x1="71.5" y1="41.2" x2="65.5" y2="43.8" />
        <line x1="28.5" y1="58.8" x2="34.5" y2="56.2" />
      </g>

      {/* Subtle Collarette Ring */}
      <circle 
        cx="50" 
        cy="50" 
        r="15" 
        fill="none" 
        stroke="#40916c" 
        strokeWidth="0.8" 
        strokeDasharray="2.5 2"
        opacity="0.55"
      />

      {/* 4. Natural Eye Pupil (Deep Dark, round) */}
      <circle 
        cx="50" 
        cy="50" 
        r="10" 
        fill="#081c15" 
      />

      {/* 5. Natural Corneal Specular Light Reflection (Highlight) */}
      <circle 
        cx="46.5" 
        cy="46.5" 
        r="3" 
        fill="#ffffff" 
        opacity="0.95"
      />
      <circle 
        cx="53.5" 
        cy="53" 
        r="1.3" 
        fill="#ffffff" 
        opacity="0.65"
      />
    </svg>
  );
}

export default function AuthPage({ onLogin }) {
  // 1. Initial 2-second EyeReach Welcome/Splash Screen
  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);

  useEffect(() => {
    const splashTimer = setTimeout(() => {
      setSplashFading(true);
      const exitTimer = setTimeout(() => {
        setShowSplash(false);
      }, 550); // smooth fade-out
      return () => clearTimeout(exitTimer);
    }, 2000); // exactly 2 seconds display
    return () => clearTimeout(splashTimer);
  }, []);

  // Portal Switcher: 'customer' | 'shop'
  const [role, setRole] = useState('customer');

  // Customer Login Option: 'mobile' (Option A - Primary) | 'email' (Option B - Alternative)
  const [customerMethod, setCustomerMethod] = useState('mobile');

  // Primary Login: Mobile Details State
  const [mobileForm, setMobileForm] = useState({
    name: '',
    mobile: '',
    address: ''
  });

  // Alternative Login: Email & Password State
  const [emailForm, setEmailForm] = useState({
    name: '',
    mobile: '',
    email: '',
    address: '',
    password: ''
  });
  const [isCustomerRegister, setIsCustomerRegister] = useState(false);

  // Optical Shop Owner State
  const [shopForm, setShopForm] = useState({
    owner_name: '',
    shop_name: '',
    mobile_number: '',
    email: '',
    shop_address: '',
    password: '',
    confirm_password: ''
  });
  const [isShopRegister, setIsShopRegister] = useState(false);

  // Doctor / Optometrist State
  const [doctorForm, setDoctorForm] = useState({
    email: '',
    password: ''
  });

  // UI States
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);

  // Forgot Password Modal
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotStatus, setForgotStatus] = useState(null);

  // ----------------- PRIMARY LOGIN: DIRECT MOBILE DETAILS -----------------
  const handleMobileLogin = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    const cleanName = mobileForm.name.trim();
    if (!cleanName) {
      setAuthError('Please enter your Full Name.');
      return;
    }

    const cleanMobile = mobileForm.mobile.replace(/\D/g, '');
    if (cleanMobile.length < 10) {
      setAuthError('Please enter a valid 10-digit mobile number.');
      return;
    }

    const cleanAddress = mobileForm.address ? mobileForm.address.trim() : '';
    if (!cleanAddress) {
      setAuthError('Please enter your Home Address.');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post('/api/customer/mobile-login', {
        name: cleanName,
        mobile: cleanMobile.slice(-10),
        address: cleanAddress
      });

      localStorage.setItem('smartframe_token', res.data.token);
      onLogin({
        isGuest: false,
        role: 'customer',
        ...res.data.customer
      }, res.data.is_returning);
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Login failed. Please check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ----------------- ALTERNATIVE LOGIN: EMAIL & PASSWORD -----------------
  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    if (!emailForm.email.trim()) {
      setAuthError('Please enter your Email Address.');
      return;
    }
    if (!emailForm.password) {
      setAuthError('Please enter your Password.');
      return;
    }

    setLoading(true);
    try {
      if (!isCustomerRegister) {
        const res = await axios.post('/api/customer/login', {
          email: emailForm.email.trim(),
          password: emailForm.password
        });
        localStorage.setItem('smartframe_token', res.data.token);
        onLogin({
          isGuest: false,
          role: 'customer',
          ...res.data.customer
        }, true);
      } else {
        const res = await axios.post('/api/customer/register', {
          name: emailForm.name.trim() || 'Patient',
          mobile: emailForm.mobile.trim() || '0000000000',
          email: emailForm.email.trim(),
          address: emailForm.address ? emailForm.address.trim() : '',
          password: emailForm.password
        });
        localStorage.setItem('smartframe_token', res.data.token);
        onLogin({
          isGuest: false,
          role: 'customer',
          ...res.data.customer
        }, false);
      }
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  // ----------------- OPTICAL SHOP OWNER AUTH -----------------
  const handleShopSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    try {
      if (!isShopRegister) {
        const res = await axios.post('/api/shop/login', {
          email: shopForm.email.trim(),
          password: shopForm.password
        });
        localStorage.setItem('smartframe_token', res.data.token);
        onLogin({
          isGuest: false,
          role: 'shop_owner',
          ...res.data.shop
        }, true);
      } else {
        if (shopForm.password !== shopForm.confirm_password) {
          setAuthError('Passwords do not match.');
          setLoading(false);
          return;
        }
        const res = await axios.post('/api/shop/register', shopForm);
        localStorage.setItem('smartframe_token', res.data.token);
        onLogin({
          isGuest: false,
          role: 'shop_owner',
          ...res.data.shop
        }, false);
      }
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Optical store authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  // ----------------- DOCTOR / OPTOMETRIST AUTH -----------------
  const handleDoctorLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    if (!doctorForm.email.trim()) {
      setAuthError('Please enter doctor email address.');
      setLoading(false);
      return;
    }
    if (!doctorForm.password) {
      setAuthError('Please enter password.');
      setLoading(false);
      return;
    }

    try {
      const res = await axios.post('/api/doctor/login', {
        email: doctorForm.email.trim(),
        password: doctorForm.password
      });
      localStorage.setItem('smartframe_token', res.data.token);
      onLogin({
        isGuest: false,
        role: 'doctor',
        ...res.data.doctor
      }, true);
    } catch (err) {
      setAuthError(err.response?.data?.detail || 'Doctor authentication failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  // ----------------- FORGOT PASSWORD -----------------
  const handleForgotPasswordSubmit = async (e) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    setForgotStatus(null);

    try {
      await axios.post('/api/customer/forgot-password', { email: forgotEmail.trim() });
      setForgotStatus({
        type: 'success',
        message: `Password reset instructions have been sent to ${forgotEmail}. Please check your inbox.`
      });
    } catch (err) {
      setForgotStatus({
        type: 'error',
        message: 'Could not send reset instructions at this moment.'
      });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="eyereach-auth-root">
      {/* ================= 1. FIRST SCREEN: EYEREACH WELCOME / SPLASH SCREEN ================= */}
      {showSplash && (
        <div className={`eyereach-splash-overlay ${splashFading ? 'fading' : ''}`}>
          <div 
            className="eyereach-splash-bg"
            style={{ backgroundImage: `url(${irisBg})` }}
          />
          <div className="eyereach-splash-gradient-layer" />

          {/* Glowing Animated Iris Circles */}
          <div className="eyereach-splash-ring ring-outer" />
          <div className="eyereach-splash-ring ring-middle" />
          <div className="eyereach-splash-ring ring-inner" />

          {/* Central Logo & Brand */}
          <div className="eyereach-splash-center">
            <div className="eyereach-splash-icon-halo">
              <div className="eyereach-splash-icon-core">
                <EyeReachLogo size={82} />
              </div>
            </div>
            <h1 className="eyereach-splash-brand-title">
              Eye<span>Reach</span>
            </h1>
            <div className="eyereach-splash-accent-bar" />
          </div>
        </div>
      )}

      {/* AMBIENT EYE BACKGROUND */}
      <div 
        className="eyereach-iris-ambient-bg"
        style={{ backgroundImage: `url(${irisBg})` }}
      />
      <div className="eyereach-iris-ambient-overlay" />

      {/* DYNAMIC OPTIC RETICLE CIRCLES */}
      <div className="eyereach-optic-circle eyereach-optic-circle-1" />
      <div className="eyereach-optic-circle eyereach-optic-circle-2" />

      {/* ================= 2. LOGIN PAGE: ATTRACTIVE SPLIT-SCREEN ================= */}
      <div className="eyereach-auth-container">
        
        {/* ================= LEFT SECTION: MINIMAL & ELEGANT EYE/IRIS VISUAL ================= */}
        <div className="eyereach-hero-panel">
          <div 
            className="eyereach-hero-bg-iris"
            style={{ backgroundImage: `url(${irisBg})` }}
          />
          <div className="eyereach-hero-gradient-overlay" />

          {/* Top Brand Header */}
          <div className="eyereach-brand-header">
            <div className="eyereach-brand-eye-icon">
              <EyeReachLogo size={42} />
            </div>
            <div>
              <h1 className="eyereach-brand-title">
                Eye<span>Reach</span>
              </h1>
              <p className="eyereach-brand-tagline">
                See Better. Live Better. Choose EyeReach.
              </p>
            </div>
          </div>

          {/* Centerpiece: Large Beautiful Iris Artwork with Glowing Reticles */}
          <div className="eyereach-minimal-iris-center">
            <div className="eyereach-iris-art-frame">
              <div className="eyereach-iris-reticle-ring ring-1" />
              <div className="eyereach-iris-reticle-ring ring-2" />
              <div className="eyereach-iris-reticle-ring ring-3" />
              <div className="eyereach-iris-center-disc">
                <div 
                  className="eyereach-iris-disc-image"
                  style={{ backgroundImage: `url(${irisBg})` }}
                />
                <div className="eyereach-iris-disc-pupil">
                  <div className="eyereach-pupil-twinkle main-twinkle" />
                  <div className="eyereach-pupil-twinkle sub-twinkle" />
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Clean Accent */}
          <div className="eyereach-hero-minimal-footer">
            <div className="eyereach-footer-brand-pill">
              <span className="eyereach-pill-dot" />
              <span>Clinical Optometry & Home Vision Care</span>
            </div>
          </div>
        </div>

        {/* ================= RIGHT SECTION: EASY-TO-USE LOGIN FORM ================= */}
        <div className="eyereach-form-panel">
          
          {/* Portal Switcher (Customer vs Shop Owner / Optometrist) */}
          <div className="eyereach-portal-toggle">
            <button
              type="button"
              className={`eyereach-portal-btn ${role === 'customer' ? 'active-teal' : ''}`}
              onClick={() => { setRole('customer'); setAuthError(null); setAuthSuccess(null); }}
            >
              <User size={18} />
              <span>Customer</span>
            </button>
            <button
              type="button"
              className={`eyereach-portal-btn ${role === 'shop' ? 'active-navy' : ''}`}
              onClick={() => { setRole('shop'); setAuthError(null); setAuthSuccess(null); }}
            >
              <Store size={18} />
              <span>Shop Owner / Optometrist</span>
            </button>
          </div>

          {/* Heading */}
          <div className="eyereach-login-heading-wrap">
            <h2 className="eyereach-main-heading">
              {role === 'customer' 
                ? 'Your Vision, Your Care, Your EyeReach.' 
                : 'Shop Owner & Optometrist Portal'}
            </h2>
            <p className="eyereach-sub-description">
              {role === 'customer'
                ? (customerMethod === 'mobile' 
                    ? 'Enter your details below for simple, instant access to home testing.' 
                    : 'Sign in with your registered email and password credentials.')
                : 'Direct communication portal between customer and optical shop owner or optometrist for home visits, vision tests, and orders.'}
            </p>
          </div>

          {/* Status Alerts */}
          {authError && (
            <div className="eyereach-alert error">
              <AlertCircle size={20} style={{ flexShrink: 0 }} />
              <span>{authError}</span>
            </div>
          )}

          {authSuccess && (
            <div className="eyereach-alert success">
              <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
              <span>{authSuccess}</span>
            </div>
          )}

          {/* ================= CUSTOMER PORTAL ================= */}
          {role === 'customer' && (
            <div className="eyereach-customer-body">
              {customerMethod === 'mobile' ? (
                /* ----------------- PRIMARY LOGIN: MOBILE DETAILS ----------------- */
                <form onSubmit={handleMobileLogin} className="eyereach-form-stack">
                  {/* 1. Full Name - Required */}
                  <div className="eyereach-field-group">
                    <label className="eyereach-label">
                      <span>Full Name <strong className="required-star">*</strong></span>
                    </label>
                    <div className="eyereach-input-box">
                      <span className="eyereach-input-icon"><User size={22} /></span>
                      <input
                        type="text"
                        required
                        placeholder="Enter your full name (e.g. Ramesh Kumar)"
                        value={mobileForm.name}
                        onChange={(e) => setMobileForm({ ...mobileForm, name: e.target.value })}
                        className="eyereach-input"
                      />
                    </div>
                  </div>

                  {/* 2. Mobile Number - Required */}
                  <div className="eyereach-field-group">
                    <label className="eyereach-label">
                      <span>Mobile Number <strong className="required-star">*</strong></span>
                      <span className="eyereach-label-hint">10 digits</span>
                    </label>
                    <div className="eyereach-input-box">
                      <span className="eyereach-input-icon"><Phone size={22} /></span>
                      <input
                        type="tel"
                        required
                        maxLength={10}
                        placeholder="Enter 10-digit mobile number"
                        value={mobileForm.mobile}
                        onChange={(e) => setMobileForm({ ...mobileForm, mobile: e.target.value.replace(/\D/g, '') })}
                        className="eyereach-input"
                      />
                    </div>
                  </div>

                  {/* 3. Home Address - Required */}
                  <div className="eyereach-field-group">
                    <label className="eyereach-label">
                      <span>Home Address <strong className="required-star">*</strong></span>
                      <span className="eyereach-label-hint">For home vision testing & frame delivery</span>
                    </label>
                    <div className="eyereach-input-box">
                      <span className="eyereach-input-icon"><MapPin size={22} /></span>
                      <input
                        type="text"
                        required
                        placeholder="Enter your complete home address"
                        value={mobileForm.address}
                        onChange={(e) => setMobileForm({ ...mobileForm, address: e.target.value })}
                        className="eyereach-input"
                      />
                    </div>
                  </div>

                  {/* Large, Elderly-Friendly Action Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="eyereach-action-btn primary-teal"
                  >
                    {loading ? 'Continuing...' : (
                      <>
                        <span>Continue to EyeReach</span>
                        <ArrowRight size={22} />
                      </>
                    )}
                  </button>

                  {/* Small, Clear Option: Use Email Instead */}
                  <div className="eyereach-alt-switch-wrap">
                    <button
                      type="button"
                      className="eyereach-alt-switch-btn"
                      onClick={() => {
                        setCustomerMethod('email');
                        setAuthError(null);
                        setAuthSuccess(null);
                      }}
                    >
                      <Mail size={16} />
                      <span>Use Email Instead</span>
                    </button>
                  </div>
                </form>
              ) : (
                /* ----------------- ALTERNATIVE LOGIN: EMAIL INSTEAD ----------------- */
                <form onSubmit={handleEmailLogin} className="eyereach-form-stack">
                  {isCustomerRegister && (
                    <>
                      <div className="eyereach-field-group">
                        <label className="eyereach-label">
                          <span>Full Name <strong className="required-star">*</strong></span>
                        </label>
                        <div className="eyereach-input-box">
                          <span className="eyereach-input-icon"><User size={22} /></span>
                          <input
                            type="text"
                            required
                            placeholder="Enter your full name"
                            value={emailForm.name}
                            onChange={(e) => setEmailForm({ ...emailForm, name: e.target.value })}
                            className="eyereach-input"
                          />
                        </div>
                      </div>

                      <div className="eyereach-field-group">
                        <label className="eyereach-label">
                          <span>Mobile Number <strong className="required-star">*</strong></span>
                        </label>
                        <div className="eyereach-input-box">
                          <span className="eyereach-input-icon"><Phone size={22} /></span>
                          <input
                            type="tel"
                            required
                            maxLength={10}
                            placeholder="10-digit mobile number"
                            value={emailForm.mobile}
                            onChange={(e) => setEmailForm({ ...emailForm, mobile: e.target.value.replace(/\D/g, '') })}
                            className="eyereach-input"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* Email Address - Required */}
                  <div className="eyereach-field-group">
                    <label className="eyereach-label">
                      <span>Email Address <strong className="required-star">*</strong></span>
                    </label>
                    <div className="eyereach-input-box">
                      <span className="eyereach-input-icon"><Mail size={22} /></span>
                      <input
                        type="email"
                        required
                        placeholder="Enter email (e.g. name@example.com)"
                        value={emailForm.email}
                        onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
                        className="eyereach-input"
                      />
                    </div>
                  </div>

                  {/* Password - Required */}
                  <div className="eyereach-field-group">
                    <div className="eyereach-label">
                      <span>Password <strong className="required-star">*</strong></span>
                      {!isCustomerRegister && (
                        <button
                          type="button"
                          onClick={() => {
                            setForgotEmail(emailForm.email || '');
                            setForgotStatus(null);
                            setShowForgotModal(true);
                          }}
                          className="eyereach-forgot-link"
                        >
                          Forgot Password?
                        </button>
                      )}
                    </div>
                    <div className="eyereach-input-box">
                      <span className="eyereach-input-icon"><Lock size={22} /></span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="Enter password"
                        value={emailForm.password}
                        onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                        className="eyereach-input"
                        style={{ paddingRight: '3.2rem' }}
                      />
                      <button
                        type="button"
                        className="eyereach-pwd-btn"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="eyereach-action-btn primary-teal"
                  >
                    {loading ? 'Authenticating...' : (
                      <>
                        <span>{isCustomerRegister ? 'Create Account' : 'Sign In with Email'}</span>
                        <ArrowRight size={22} />
                      </>
                    )}
                  </button>

                  {/* Switch Back to Mobile Details */}
                  <div className="eyereach-alt-switch-wrap">
                    <button
                      type="button"
                      className="eyereach-alt-switch-btn"
                      onClick={() => {
                        setCustomerMethod('mobile');
                        setAuthError(null);
                        setAuthSuccess(null);
                      }}
                    >
                      <Phone size={16} />
                      <span>Use Mobile Details Instead</span>
                    </button>
                  </div>

                  {/* Register Toggle for Email Users */}
                  <div className="eyereach-form-sub-toggle">
                    {isCustomerRegister ? (
                      <>
                        Already registered?{' '}
                        <button
                          type="button"
                          onClick={() => { setIsCustomerRegister(false); setAuthError(null); }}
                          className="eyereach-inline-link"
                        >
                          Sign In here
                        </button>
                      </>
                    ) : (
                      <>
                        Don't have an email account?{' '}
                        <button
                          type="button"
                          onClick={() => { setIsCustomerRegister(true); setAuthError(null); }}
                          className="eyereach-inline-link"
                        >
                          Register with email
                        </button>
                      </>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}

          {/* ================= OPTICAL SHOP OWNER PORTAL ================= */}
          {role === 'shop' && (
            <div className="eyereach-shop-body">
              <div className="eyereach-demo-banner">
                💡 <strong>Pre-seeded Demo Store:</strong> Email: <code>rajesh@visioncraft.com</code> | Password: <code>admin123</code>
              </div>

              <form onSubmit={handleShopSubmit} className="eyereach-form-stack">
                {isShopRegister && (
                  <>
                    <div className="eyereach-field-group">
                      <label className="eyereach-label">
                        <span>Owner Name <strong className="required-star">*</strong></span>
                      </label>
                      <div className="eyereach-input-box navy-box">
                        <span className="eyereach-input-icon"><User size={22} /></span>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Rajesh Sharma"
                          value={shopForm.owner_name}
                          onChange={(e) => setShopForm({ ...shopForm, owner_name: e.target.value })}
                          className="eyereach-input"
                        />
                      </div>
                    </div>

                    <div className="eyereach-field-group">
                      <label className="eyereach-label">
                        <span>Optical Shop Name <strong className="required-star">*</strong></span>
                      </label>
                      <div className="eyereach-input-box navy-box">
                        <span className="eyereach-input-icon"><Store size={22} /></span>
                        <input
                          type="text"
                          required
                          placeholder="e.g. VisionCraft Opticians"
                          value={shopForm.shop_name}
                          onChange={(e) => setShopForm({ ...shopForm, shop_name: e.target.value })}
                          className="eyereach-input"
                        />
                      </div>
                    </div>

                    <div className="eyereach-field-group">
                      <label className="eyereach-label">
                        <span>Mobile Number <strong className="required-star">*</strong></span>
                      </label>
                      <div className="eyereach-input-box navy-box">
                        <span className="eyereach-input-icon"><Phone size={22} /></span>
                        <input
                          type="tel"
                          required
                          placeholder="e.g. 9876543210"
                          value={shopForm.mobile_number}
                          onChange={(e) => setShopForm({ ...shopForm, mobile_number: e.target.value })}
                          className="eyereach-input"
                        />
                      </div>
                    </div>

                    <div className="eyereach-field-group">
                      <label className="eyereach-label">
                        <span>Shop Address <strong className="required-star">*</strong></span>
                      </label>
                      <div className="eyereach-input-box navy-box">
                        <span className="eyereach-input-icon"><MapPin size={22} /></span>
                        <input
                          type="text"
                          required
                          placeholder="Full shop address and city"
                          value={shopForm.shop_address}
                          onChange={(e) => setShopForm({ ...shopForm, shop_address: e.target.value })}
                          className="eyereach-input"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="eyereach-field-group">
                  <label className="eyereach-label">
                    <span>Store Email Address <strong className="required-star">*</strong></span>
                  </label>
                  <div className="eyereach-input-box navy-box">
                    <span className="eyereach-input-icon"><Mail size={22} /></span>
                    <input
                      type="email"
                      required
                      placeholder="e.g. store@visioncraft.com"
                      value={shopForm.email}
                      onChange={(e) => setShopForm({ ...shopForm, email: e.target.value })}
                      className="eyereach-input"
                    />
                  </div>
                </div>

                <div className="eyereach-field-group">
                  <div className="eyereach-label">
                    <span>Password <strong className="required-star">*</strong></span>
                    {!isShopRegister && (
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(shopForm.email || '');
                          setForgotStatus(null);
                          setShowForgotModal(true);
                        }}
                        className="eyereach-forgot-link"
                      >
                        Forgot Password?
                      </button>
                    )}
                  </div>
                  <div className="eyereach-input-box navy-box">
                    <span className="eyereach-input-icon"><Lock size={22} /></span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Enter password"
                      value={shopForm.password}
                      onChange={(e) => setShopForm({ ...shopForm, password: e.target.value })}
                      className="eyereach-input"
                      style={{ paddingRight: '3.2rem' }}
                    />
                    <button
                      type="button"
                      className="eyereach-pwd-btn"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                {isShopRegister && (
                  <div className="eyereach-field-group">
                    <label className="eyereach-label">
                      <span>Confirm Password <strong className="required-star">*</strong></span>
                    </label>
                    <div className="eyereach-input-box navy-box">
                      <span className="eyereach-input-icon"><Lock size={22} /></span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="Confirm password"
                        value={shopForm.confirm_password}
                        onChange={(e) => setShopForm({ ...shopForm, confirm_password: e.target.value })}
                        className="eyereach-input"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="eyereach-action-btn primary-navy"
                >
                  {loading ? 'Authenticating...' : (
                    <>
                      <span>{isShopRegister ? 'Register Optical Shop' : 'Sign In as Shop Owner / Optometrist'}</span>
                      <ArrowRight size={22} />
                    </>
                  )}
                </button>

                <div className="eyereach-form-sub-toggle">
                  {isShopRegister ? (
                    <>
                      Already registered?{' '}
                      <button
                        type="button"
                        onClick={() => { setIsShopRegister(false); setAuthError(null); }}
                        className="eyereach-inline-link"
                      >
                        Sign In here
                      </button>
                    </>
                  ) : (
                    <>
                      Register a new optical branch?{' '}
                      <button
                        type="button"
                        onClick={() => { setIsShopRegister(true); setAuthError(null); }}
                        className="eyereach-inline-link"
                      >
                        Register Shop
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* ================= DOCTOR / OPTOMETRIST PORTAL ================= */}
          {role === 'doctor' && (
            <div className="eyereach-shop-body">
              <form onSubmit={handleDoctorLogin} className="eyereach-form-stack">
                <div className="eyereach-field-group">
                  <label className="eyereach-label">
                    <span>Doctor / Optometrist Email <strong className="required-star">*</strong></span>
                  </label>
                  <div className="eyereach-input-box" style={{ borderColor: '#059669' }}>
                    <span className="eyereach-input-icon"><Mail size={22} color="#059669" /></span>
                    <input
                      type="email"
                      required
                      placeholder="e.g. doctor@eyereach.com"
                      value={doctorForm.email}
                      onChange={(e) => setDoctorForm({ ...doctorForm, email: e.target.value })}
                      className="eyereach-input"
                    />
                  </div>
                </div>

                <div className="eyereach-field-group">
                  <div className="eyereach-label">
                    <span>Password <strong className="required-star">*</strong></span>
                  </div>
                  <div className="eyereach-input-box" style={{ borderColor: '#059669' }}>
                    <span className="eyereach-input-icon"><Lock size={22} color="#059669" /></span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Enter password"
                      value={doctorForm.password}
                      onChange={(e) => setDoctorForm({ ...doctorForm, password: e.target.value })}
                      className="eyereach-input"
                    />
                    <button
                      type="button"
                      className="eyereach-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                <div style={{
                  padding: '0.75rem 0.95rem',
                  backgroundColor: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: '8px',
                  fontSize: '0.80rem',
                  color: '#065f46',
                  lineHeight: 1.45
                }}>
                  <div style={{ fontWeight: 800, marginBottom: '2px' }}>🩺 Clinical Optometry Account:</div>
                  <div>Default Demo Doctor: <strong>doctor@eyereach.com</strong> (Password: <code>doctor123</code>)</div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="eyereach-action-btn"
                  style={{
                    backgroundColor: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.3)'
                  }}
                >
                  {loading ? 'Authenticating Doctor Account...' : (
                    <>
                      <span>Sign In to Doctor Console</span>
                      <ArrowRight size={22} />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ================= FORGOT PASSWORD MODAL ================= */}
      {showForgotModal && (
        <div className="eyereach-modal-backdrop" onClick={() => setShowForgotModal(false)}>
          <div className="eyereach-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="eyereach-modal-header">
              <h3 className="eyereach-modal-title">Reset Your Password</h3>
              <button
                type="button"
                className="eyereach-modal-close"
                onClick={() => setShowForgotModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            <p className="eyereach-modal-desc">
              Enter your registered email address and we will dispatch password recovery instructions.
            </p>

            {forgotStatus && (
              <div className={`eyereach-alert ${forgotStatus.type}`} style={{ marginBottom: '1.25rem' }}>
                {forgotStatus.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                <span>{forgotStatus.message}</span>
              </div>
            )}

            <form onSubmit={handleForgotPasswordSubmit}>
              <div className="eyereach-field-group">
                <label className="eyereach-label">Email Address *</label>
                <div className="eyereach-input-box">
                  <span className="eyereach-input-icon"><Mail size={20} /></span>
                  <input
                    type="email"
                    required
                    placeholder="Enter registered email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="eyereach-input"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="eyereach-cancel-btn"
                  onClick={() => setShowForgotModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="eyereach-action-btn primary-teal"
                  style={{ flex: 1 }}
                >
                  {forgotLoading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
