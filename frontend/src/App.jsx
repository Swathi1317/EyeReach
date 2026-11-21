import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import { Camera, RefreshCw, AlertTriangle, ArrowLeft, CheckCircle2, X } from 'lucide-react';
import './App.css';
import VirtualTryOn from './components/VirtualTryOn';
import FitStabilityReport from './components/FitStabilityReport';
import AuthPage, { EyeReachLogo } from './components/AuthPage';
import ShopDashboard from './components/ShopDashboard/ShopDashboard';
import CustomerPortal from './components/CustomerPortal/CustomerPortal';
import AppointmentScheduler from './components/AppointmentScheduler';

const API_BASE = '';

const SMART_GUIDED_STATES = {
  IDLE: 'IDLE',
  WAITING_FOR_FACE: 'WAITING_FOR_FACE',
  CHECKING_FRONT_POSE: 'CHECKING_FRONT_POSE',
  GUIDING_FRONT: 'GUIDING_FRONT',
  VERIFYING_FRONT_STABILITY: 'VERIFYING_FRONT_STABILITY',
  CAPTURING_FRONT: 'CAPTURING_FRONT',
  GUIDING_RIGHT: 'GUIDING_RIGHT',
  VERIFYING_RIGHT_POSE: 'VERIFYING_RIGHT_POSE',
  VERIFYING_RIGHT_STABILITY: 'VERIFYING_RIGHT_STABILITY',
  CAPTURING_RIGHT: 'CAPTURING_RIGHT',
  GUIDING_LEFT: 'GUIDING_LEFT',
  VERIFYING_LEFT_POSE: 'VERIFYING_LEFT_POSE',
  VERIFYING_LEFT_STABILITY: 'VERIFYING_LEFT_STABILITY',
  CAPTURING_LEFT: 'CAPTURING_LEFT',
  PROCESSING: 'PROCESSING',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
  // Backwards-compatible aliases
  CAMERA_INIT: 'WAITING_FOR_FACE',
  FRONT_GUIDANCE: 'GUIDING_FRONT',
  FRONT_STABILITY: 'VERIFYING_FRONT_STABILITY',
  FRONT_CAPTURED: 'CAPTURING_FRONT',
  RIGHT_GUIDANCE: 'GUIDING_RIGHT',
  RIGHT_STABILITY: 'VERIFYING_RIGHT_STABILITY',
  RIGHT_CAPTURED: 'CAPTURING_RIGHT',
  LEFT_GUIDANCE: 'GUIDING_LEFT',
  LEFT_STABILITY: 'VERIFYING_LEFT_STABILITY',
  LEFT_CAPTURED: 'CAPTURING_LEFT',
  RESULTS_READY: 'COMPLETE'
};

const AUTO_STATES = SMART_GUIDED_STATES;

const CAPTURE_SUBSTATES = {
  WAITING_FOR_POSE: 'WAITING_FOR_POSE',
  TARGET_REACHED: 'TARGET_REACHED',
  SPEAKING_HOLD_INSTRUCTION: 'SPEAKING_HOLD_INSTRUCTION',
  VERIFYING_STABILITY: 'VERIFYING_STABILITY',
  CAPTURING: 'CAPTURING',
  CAPTURE_COMPLETE: 'CAPTURE_COMPLETE'
};

const GUIDANCE_STATES = {
  INITIAL: 'INITIAL',
  WRONG_DIRECTION: 'WRONG_DIRECTION',
  WAITING_FOR_TURN: 'WAITING_FOR_TURN',
  BARELY_TURNED: 'BARELY_TURNED',
  APPROACHING: 'APPROACHING',
  TARGET_REACHED: 'TARGET_REACHED',
  TOO_FAR: 'TOO_FAR',
  MOVING_TOO_MUCH: 'MOVING_TOO_MUCH',
  NOT_CENTERED: 'NOT_CENTERED',
  POOR_LIGHTING: 'POOR_LIGHTING',
  TOO_CLOSE: 'TOO_CLOSE',
  LANDMARKS_OBSCURED: 'LANDMARKS_OBSCURED',
  CAPTURE_COMPLETE: 'CAPTURE_COMPLETE'
};

const GUIDANCE_CONFIG = {
  // Head yaw thresholds in physical degrees (negative = turn left, positive = turn right, matching OpenCV solvePnP)
  FRONT_MAX_YAW: 15.0,           // Front view range: |yaw| <= 15°
  PROFILE_MIN_YAW: 50.0,         // Target side-profile threshold: 50° to 86° (captures user profile reliably from 55° to 75°)
  PROFILE_MAX_YAW: 86.0,         // Max permissible profile angle (FaceMesh drops tracking above 87°)
  APPROACHING_YAW: 28.0,         // Turning threshold: 28° to 50° (triggers "Turn further")
  WRONG_DIR_YAW: 18.0,           // User turned opposite direction by > 18°
  TOO_FAR_YAW: 87.0,             // Head turned too far away (> 87°)

  // Motion velocity threshold (normalized distance / sec)
  MAX_STABLE_VELOCITY: 0.45,

  // Frame boundary margins (normalized 0..1)
  MARGIN_MIN: 0.015,
  MARGIN_MAX: 0.985,

  // Centering & distance thresholds
  CENTER_MIN_X: 0.20,
  CENTER_MAX_X: 0.80,
  TOO_CLOSE_FACE_HEIGHT: 0.80,

  // Utterance cooldowns (ms)
  STATE_CHANGE_COOLDOWN: 2000,
  SAME_STATE_COOLDOWN: 3800,
  WRONG_TURN_COOLDOWN: 3800,

  // Front stability for MAD IPD buffer collection (~500ms at ~30fps: 15 frames)
  FRONT_REQUIRED_STABILITY_FRAMES: 15,
  REQUIRED_STABILITY_FRAMES: 15,

  // Steady hold stability confirmation for side profiles (~600–700ms: 18 frames, min 600ms elapsed)
  SIDE_REQUIRED_STABILITY_FRAMES: 18,
  SIDE_MIN_STABILITY_MS: 600
};

// Direct Anthropometric 3D Head Pose Estimator for MediaPipe FaceMesh

const estimateHeadPoseFromLandmarks = (lm, width = 1280, height = 720) => {
  if (!lm || lm.length < 468 || !lm[1] || !lm[33] || !lm[263] || !lm[10] || !lm[152]) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  // 1. Roll: Optical angle of the inter-pupillary / inter-ocular line in the 2D image plane
  const pR = lm[468] || lm[33];
  const pL = lm[473] || lm[263];
  const eyeDx = (pL.x - pR.x) * width;
  const eyeDy = (pL.y - pR.y) * height;
  const roll = Math.atan2(eyeDy, eyeDx) * (180.0 / Math.PI);

  // 2. Yaw: Normalized horizontal nose displacement from midpoint of outer eye corners + ear Z depth
  // Negative = Turn Left, Positive = Turn Right
  const eyeMidX = (lm[33].x + lm[263].x) / 2.0;
  const eyeSpan = Math.hypot((lm[263].x - lm[33].x) * width, (lm[263].y - lm[33].y) * height);
  const noseDx = (lm[1].x - eyeMidX) * width;
  const normNose = Math.max(-1.0, Math.min(1.0, noseDx / Math.max(1.0, eyeSpan * 0.45)));
  const yawFromNose = -Math.asin(normNose) * (180.0 / Math.PI);

  let yaw = yawFromNose;
  if (lm[454] && lm[234]) {
    const earDz = (lm[454].z || 0) - (lm[234].z || 0);
    const earDx = Math.abs((lm[454].x - lm[234].x) * width);
    const earYaw = -Math.atan2(earDz * width, Math.max(10.0, earDx)) * (180.0 / Math.PI);
    yaw = 0.65 * yawFromNose + 0.35 * earYaw;
  }

  // 3. Pitch: Vertical displacement of nose relative to forehead-to-chin midline
  const faceH = Math.abs((lm[152].y - lm[10].y) * height);
  const midY = ((lm[10].y + lm[152].y) / 2.0) * height;
  const noseY = lm[1].y * height;
  const neutralNoseOffset = faceH * 0.055;
  const pitchOffset = (noseY - midY - neutralNoseOffset) / Math.max(1.0, faceH * 0.35);
  const pitch = pitchOffset * 45.0;

  return {
    yaw: Math.round(Math.max(-85.0, Math.min(85.0, yaw)) * 10) / 10,
    pitch: Math.round(Math.max(-45.0, Math.min(45.0, pitch)) * 10) / 10,
    roll: Math.round(Math.max(-45.0, Math.min(45.0, roll)) * 10) / 10
  };
};


const playCaptureChime = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.22);
  } catch (e) {
    // Audio context may be restricted by browser until user gesture
  }
};

const speakVoice = (text, onEnd, force = true) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }

  try {
    if (window.speechSynthesis.speaking && !force) {
      if (onEnd) onEnd();
      return;
    }

    if (force) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices() || [];
    const englishVoice = 
      voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Jenny') || v.name.includes('Aria') || v.name.includes('Guy'))) ||
      voices.find(v => v.lang.startsWith('en')) ||
      voices[0];

    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        if (onEnd) onEnd();
      }
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    // Safety timeout so execution never hangs
    const maxDuration = Math.max(2200, text.length * 100);
    setTimeout(finish, maxDuration);

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("SpeechSynthesis error:", err);
    if (onEnd) onEnd();
  }
};

const speakVoiceAsync = (text, force = true) => {
  return new Promise((resolve) => {
    speakVoice(text, resolve, force);
  });
};

const validateHeadCircumference = (val) => {
  if (val === null || val === undefined) {
    return { isValid: false, valueCm: null, error: null };
  }
  const str = String(val).trim();
  if (str === '') {
    return { isValid: false, valueCm: null, error: null };
  }
  const num = Number(str);
  if (isNaN(num)) {
    return { isValid: false, valueCm: null, error: 'Must be a numeric value' };
  }
  if (num <= 0) {
    return { isValid: false, valueCm: null, error: 'Must be greater than 0' };
  }
  if (num < 45.0 || num > 68.0) {
    return { isValid: false, valueCm: null, error: 'Enter a valid adult size (45.0 – 68.0 cm)' };
  }
  return { isValid: true, valueCm: num, error: null };
};

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [welcomeNotice, setWelcomeNotice] = useState(null); // { name: string, isReturning: boolean }
  const [activeView, setActiveView] = useState('dashboard'); // 'dashboard' | 'scanner'
  const [homeVisitSelectedFrames, setHomeVisitSelectedFrames] = useState([]);
  const [scanMode, setScanMode] = useState('three_view'); // 'straight' | 'three_view'
  const [stream, setStream] = useState(null);
  const [sessionState, setSessionState] = useState(AUTO_STATES.IDLE);
  const sessionStateRef = useRef(AUTO_STATES.IDLE);

  // EyeReach: Automatic Login / Session Persistence Check on Initial Mount
  useEffect(() => {
    const token = localStorage.getItem('smartframe_token');
    if (!token) {
      setIsCheckingSession(false);
      return;
    }

    axios.get('/api/customer/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (res.data?.status === 'success') {
          const role = res.data.role;
          const userData = role === 'shop_owner' ? res.data.shop : res.data.customer;
          const fullUser = {
            isGuest: false,
            role: role || 'customer',
            ...userData
          };
          setCurrentUser(fullUser);
          setIsAuthenticated(true);
          if (role === 'shop_owner') {
            setActiveView('shop_dashboard');
          } else {
            setActiveView('catalog');
          }
          const actualName = fullUser.name || fullUser.owner_name || 'Valued User';
          setWelcomeNotice({
            name: actualName,
            isReturning: true
          });
        } else {
          localStorage.removeItem('smartframe_token');
          setIsAuthenticated(false);
        }
      })
      .catch(() => {
        // Expired or invalid token
        localStorage.removeItem('smartframe_token');
        setIsAuthenticated(false);
      })
      .finally(() => {
        setIsCheckingSession(false);
      });
  }, []);

  // Auto-dismiss welcome notice after 8 seconds
  useEffect(() => {
    if (!welcomeNotice) return;
    const timer = setTimeout(() => {
      setWelcomeNotice(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [welcomeNotice]);
  
  const [stabilityProgress, setStabilityProgress] = useState(0);
  const [flashActive, setFlashActive] = useState(false);
  const [poseStatus, setPoseStatus] = useState('Waiting for face');
  const [liveGuidance, setLiveGuidance] = useState({
    main: 'Look straight at the camera.',
    corrective: false
  });
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [sideErrorMsg, setSideErrorMsg] = useState('');
  
  const [phase1Result, setPhase1Result] = useState(null);
  const [phase2Result, setPhase2Result] = useState(null);
  const [showResults, setShowResults] = useState(false);
  
  const [recommendations, setRecommendations] = useState(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedRightImage, setCapturedRightImage] = useState(null);
  const [capturedLeftImage, setCapturedLeftImage] = useState(null);
  
  const [rightSideResult, setRightSideResult] = useState(null);
  const [leftSideResult, setLeftSideResult] = useState(null);
  const [headCircumferenceResult, setHeadCircumferenceResult] = useState(null);
  const [userHeadCircumference, setUserHeadCircumference] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [preferredColor, setPreferredColor] = useState('');
  
  // VTO & Fit Analysis States
  const [showTryOn, setShowTryOn] = useState(false);
  const [tryOnFrame, setTryOnFrame] = useState(null);
  const [tryOnMode, setTryOnMode] = useState('tryon');
  const [savedFitReports, setSavedFitReports] = useState({});
  const [activeFitReportView, setActiveFitReportView] = useState(null);
  const [imgError, setImgError] = useState({});
  const [expandedSpecsId, setExpandedSpecsId] = useState(null);

  const getFrameSizeBadge = (w) => {
    if (!w || isNaN(w)) return { label: 'Size: Unlisted', category: 'Standard', color: '#64748b', bg: '#f1f5f9' };
    const width = Number(w);
    if (width < 130) {
      return { label: `Small (${width.toFixed(0)} mm)`, category: 'Small', color: '#0369a1', bg: '#e0f2fe' };
    } else if (width <= 138) {
      return { label: `Medium (${width.toFixed(0)} mm)`, category: 'Medium', color: '#0d7665', bg: '#ccfbf1' };
    } else {
      return { label: `Large (${width.toFixed(0)} mm)`, category: 'Large', color: '#7c2d12', bg: '#ffedd5' };
    }
  };

  const getBudgetBadge = (priceStr, maxBudgetFilter) => {
    const hasPrice = priceStr && priceStr !== 'N/A' && priceStr !== 'Unavailable' && !isNaN(priceStr);
    if (!hasPrice) {
      return { label: 'Price unlisted', color: '#64748b', bg: '#f1f5f9' };
    }
    const numericPrice = Number(priceStr);
    if (maxBudgetFilter && !isNaN(maxBudgetFilter) && Number(maxBudgetFilter) > 0) {
      if (numericPrice <= Number(maxBudgetFilter)) {
        return { label: `Within Budget (₹${numericPrice})`, color: '#15803d', bg: '#dcfce7' };
      } else {
        return { label: `₹${numericPrice} (> ₹${maxBudgetFilter})`, color: '#b91c1c', bg: '#fee2e2' };
      }
    }
    return { label: `₹${numericPrice}`, color: '#0f172a', bg: '#f8fafc' };
  };

  const getVisualFitStatusBadge = (frame) => {
    const fw = (frame.front_width_compatibility || '').toLowerCase();
    const fitStat = (frame.fit_status || '').toLowerCase();
    if (fw.includes('optimal') || fitStat.includes('optimal')) {
      return { label: 'Optimal Fit', color: '#15803d', bg: '#dcfce7' };
    }
    if (fw.includes('compatible') || fitStat.includes('compatible')) {
      return { label: 'Compatible', color: '#0369a1', bg: '#e0f2fe' };
    }
    if (fw.includes('wide') || fw.includes('narrow') || fitStat.includes('review')) {
      return { label: frame.front_width_compatibility || 'Review Fit', color: '#b45309', bg: '#fef3c7' };
    }
    return { label: 'Visual Check', color: '#475569', bg: '#f1f5f9' };
  };

  // Frame Specifications Storage & Modal State
  const [editingFrame, setEditingFrame] = useState(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [frameFormValues, setFrameFormValues] = useState({
    width_mm: '',
    lens_width_mm: '',
    lens_height_mm: '',
    bridge_width_mm: '',
    temple_length_mm: '',
    price: ''
  });
  const [frameUpdateStatus, setFrameUpdateStatus] = useState({ loading: false, error: null, success: null });

  const openEditFrameModal = (frame) => {
    setEditingFrame(frame);
    setFrameFormValues({
      width_mm: frame.frame_width_mm != null ? String(frame.frame_width_mm) : '',
      lens_width_mm: frame.lens_width_mm != null ? String(frame.lens_width_mm) : '',
      lens_height_mm: frame.lens_height_mm != null ? String(frame.lens_height_mm) : '',
      bridge_width_mm: frame.bridge_width_mm != null ? String(frame.bridge_width_mm) : '',
      temple_length_mm: frame.temple_length_mm != null ? String(frame.temple_length_mm) : '',
      price: frame.price && frame.price !== 'N/A' && frame.price !== 'Unavailable' ? String(frame.price) : ''
    });
    setFrameUpdateStatus({ loading: false, error: null, success: null });
  };

  const handleSaveFrameSpecs = async (e) => {
    e.preventDefault();
    if (!editingFrame) return;

    setFrameUpdateStatus({ loading: true, error: null, success: null });

    const payload = {};
    if (frameFormValues.width_mm !== '') {
      const v = parseFloat(frameFormValues.width_mm);
      if (isNaN(v) || v <= 0) {
        setFrameUpdateStatus({ loading: false, error: 'Frame width must be a positive number in mm.', success: null });
        return;
      }
      payload.width_mm = v;
    }
    if (frameFormValues.lens_width_mm !== '') {
      const v = parseFloat(frameFormValues.lens_width_mm);
      if (isNaN(v) || v <= 0) {
        setFrameUpdateStatus({ loading: false, error: 'Lens width must be a positive number in mm.', success: null });
        return;
      }
      payload.lens_width_mm = v;
    }
    if (frameFormValues.lens_height_mm !== '') {
      const v = parseFloat(frameFormValues.lens_height_mm);
      if (isNaN(v) || v <= 0) {
        setFrameUpdateStatus({ loading: false, error: 'Lens height must be a positive number in mm.', success: null });
        return;
      }
      payload.lens_height_mm = v;
    }
    if (frameFormValues.bridge_width_mm !== '') {
      const v = parseFloat(frameFormValues.bridge_width_mm);
      if (isNaN(v) || v <= 0) {
        setFrameUpdateStatus({ loading: false, error: 'Bridge width must be a positive number in mm.', success: null });
        return;
      }
      payload.bridge_width_mm = v;
    }
    if (frameFormValues.temple_length_mm !== '') {
      const v = parseFloat(frameFormValues.temple_length_mm);
      if (isNaN(v) || v <= 0) {
        setFrameUpdateStatus({ loading: false, error: 'Temple length must be a positive number in mm.', success: null });
        return;
      }
      payload.temple_length_mm = v;
    }
    if (frameFormValues.price !== '') {
      const v = parseFloat(frameFormValues.price);
      if (isNaN(v) || v <= 0) {
        setFrameUpdateStatus({ loading: false, error: 'Price must be a positive number.', success: null });
        return;
      }
      payload.price = v;
    }

    if (Object.keys(payload).length === 0) {
      setFrameUpdateStatus({ loading: false, error: 'Please enter at least one specification to update.', success: null });
      return;
    }

    try {
      await axios.put(`${API_BASE}/api/frames/${editingFrame.id}`, payload);
      setFrameUpdateStatus({ loading: false, error: null, success: 'Specifications saved! Updating fit analysis...' });
      setCatalogVersion(v => v + 1);
      setTimeout(() => {
        setEditingFrame(null);
      }, 1000);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Failed to update frame specifications.';
      setFrameUpdateStatus({ loading: false, error: detail, success: null });
    }
  };

  // Diagnostic Debug HUD State
  const [debugHudVisible, setDebugHudVisible] = useState(true);
  const [debugHudMinimized, setDebugHudMinimized] = useState(false);
  const [debugHudData, setDebugHudData] = useState({
    currentStep: 'FRONT (1/3)',
    detectedPose: 'FRONT',
    estimatedYaw: 0,
    eyeRatio: 0,
    requiredPoseReached: false,
    landmarkQuality: 'PASS',
    landmarkDetails: 'Face aligned',
    captureStatus: 'IDLE',
    rejectionReason: 'None'
  });
  const singleCaptureSideRef = useRef(null);
  const straightFaceOnlyRef = useRef(false);
  const lastHudUpdateRef = useRef(0);

  const updateDebugHud = useCallback((data) => {
    const now = performance.now();
    if (now - lastHudUpdateRef.current > 75) {
      lastHudUpdateRef.current = now;
      setDebugHudData(prev => ({ ...prev, ...data }));
    }
  }, []);
  
  const faceShapeLocked = useRef(false);
  const stabilityCountRef = useRef(0);
  const activeStreamRef = useRef(null);
  const faceMeshRef = useRef(null);
  const activeLoopRef = useRef(false);
  const animFrameIdRef = useRef(null);
  const isCapturingFrameRef = useRef(false);
  const capturedBlobsRef = useRef({ frontBlobs: [], rightBlob: null, leftBlob: null });
  const prevHcRef = useRef('');
  const prevBudgetRef = useRef('');
  const prevColorRef = useRef('');
  const stepStartTimeRef = useRef(0);
  const reminderSpokenRef = useRef(false);
  const lastSpokenWrongTurnRef = useRef(0);
  const lastSpokenPartialTurnRef = useRef(0);
  const brightnessCanvasRef = useRef(null);

  // Adaptive guidance & pose tracking refs
  const smoothRatioRef = useRef(0);
  const prevNosePosRef = useRef({ x: 0.5, y: 0.5, time: 0 });
  const smoothVelocityRef = useRef(0);
  const activeGuidanceStateRef = useRef(null);
  const candidateStateRef = useRef(null);
  const stateHoldFramesRef = useRef(0);
  const lastSpokenTextRef = useRef('');
  const lastSpokenTimeRef = useRef(0);
  const lastSpokenStateRef = useRef(null);

  // Capture state machine refs:
  // WAITING_FOR_POSE -> TARGET_REACHED -> SPEAKING_HOLD_INSTRUCTION -> VERIFYING_STABILITY -> CAPTURING -> CAPTURE_COMPLETE
  const captureSubStateRef = useRef(CAPTURE_SUBSTATES.WAITING_FOR_POSE);
  const holdCancelledRef = useRef(false);
  const activeUtteranceRef = useRef(null);
  const targetPoseCandidateFramesRef = useRef(0);
  const sideStabilityStartTimeRef = useRef(0);
  const sideJitterFramesRef = useRef(0);
  const turnTransitionUntilRef = useRef(0);

  const checkLighting = useCallback(() => {
    if (!videoRef.current) return true;
    const v = videoRef.current;
    if (!v.videoWidth || !v.videoHeight) return true;
    try {
      if (!brightnessCanvasRef.current) {
        brightnessCanvasRef.current = document.createElement('canvas');
        brightnessCanvasRef.current.width = 32;
        brightnessCanvasRef.current.height = 32;
      }
      const bCtx = brightnessCanvasRef.current.getContext('2d');
      bCtx.drawImage(v, 0, 0, 32, 32);
      const imgData = bCtx.getImageData(0, 0, 32, 32).data;
      let totalLuminance = 0;
      const count = imgData.length / 4;
      for (let i = 0; i < imgData.length; i += 4) {
        totalLuminance += 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
      }
      const avgLuminance = totalLuminance / count;
      return avgLuminance >= 32;
    } catch (e) {
      return true;
    }
  }, []);

  const resetGuidanceTracking = () => {
    smoothRatioRef.current = 0;
    prevNosePosRef.current = { x: 0.5, y: 0.5, time: 0 };
    smoothVelocityRef.current = 0;
    activeGuidanceStateRef.current = null;
    candidateStateRef.current = null;
    stateHoldFramesRef.current = 0;
    lastSpokenTextRef.current = '';
    lastSpokenTimeRef.current = 0;
    lastSpokenStateRef.current = null;
    stabilityCountRef.current = 0;
    captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
    holdCancelledRef.current = false;
    targetPoseCandidateFramesRef.current = 0;
    activeUtteranceRef.current = null;
    sideStabilityStartTimeRef.current = 0;
    sideJitterFramesRef.current = 0;
    isCapturingFrameRef.current = false;
  };

  const cancelHoldInstruction = useCallback(() => {
    holdCancelledRef.current = true;
    captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
    stabilityCountRef.current = 0;
    targetPoseCandidateFramesRef.current = 0;
    activeUtteranceRef.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
  }, []);

  const speakHoldInstruction = useCallback((phraseText, onFinished) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onFinished) onFinished();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      holdCancelledRef.current = false;
      lastSpokenStateRef.current = GUIDANCE_STATES.TARGET_REACHED;
      lastSpokenTextRef.current = phraseText;
      lastSpokenTimeRef.current = Date.now();

      const utterance = new SpeechSynthesisUtterance(phraseText);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices() || [];
      const englishVoice = 
        voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Jenny') || v.name.includes('Aria') || v.name.includes('Guy'))) ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0];

      if (englishVoice) {
        utterance.voice = englishVoice;
      }

      let completed = false;
      const complete = () => {
        if (!completed) {
          completed = true;
          activeUtteranceRef.current = null;
          if (onFinished && !holdCancelledRef.current) {
            onFinished();
          }
        }
      };

      utterance.onend = complete;
      utterance.onerror = complete;

      // Chrome garbage collection protection
      activeUtteranceRef.current = utterance;

      // Safety timeout so execution never hangs if onend fails to fire
      const maxDuration = Math.max(2200, (phraseText || '').length * 100);
      setTimeout(complete, maxDuration);

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("SpeechSynthesis error:", err);
      if (onFinished) onFinished();
    }
  }, []);

  const speakAdaptiveGuidance = useCallback((targetState, phraseText, force = false) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    
    // Do not speak regular guidance during active hold instruction or stability verification unless forced or reaching target
    if (!force && (captureSubStateRef.current === CAPTURE_SUBSTATES.SPEAKING_HOLD_INSTRUCTION || 
                   captureSubStateRef.current === CAPTURE_SUBSTATES.VERIFYING_STABILITY)) {
      if (targetState !== GUIDANCE_STATES.TARGET_REACHED) {
        return;
      }
    }

    const now = Date.now();
    const isSpeaking = window.speechSynthesis.speaking;

    if (force) {
      lastSpokenTextRef.current = phraseText;
      lastSpokenStateRef.current = targetState;
      lastSpokenTimeRef.current = now;
      speakVoice(phraseText, null, true);
      return;
    }

    if (isSpeaking) {
      return;
    }

    const isSameState = (targetState === lastSpokenStateRef.current);
    const timeSinceLastSpoken = now - lastSpokenTimeRef.current;
    const cooldown = isSameState 
      ? GUIDANCE_CONFIG.SAME_STATE_COOLDOWN 
      : GUIDANCE_CONFIG.STATE_CHANGE_COOLDOWN;

    if (timeSinceLastSpoken >= cooldown) {
      lastSpokenTextRef.current = phraseText;
      lastSpokenStateRef.current = targetState;
      lastSpokenTimeRef.current = now;
      speakVoice(phraseText, null, false);
    }
  }, []);

  // Keep sessionStateRef in sync with sessionState
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  // Recalculate recommendations when manual head circumference, budget, or color filters are altered
  useEffect(() => {
    if (showResults && phase1Result && !phase1Result.error && phase2Result && phase2Result.quality?.status === 'valid') {
      const hcChanged = prevHcRef.current !== userHeadCircumference;
      const budgetChanged = prevBudgetRef.current !== maxBudget;
      const colorChanged = prevColorRef.current !== preferredColor;
      
      if (!hcChanged && !budgetChanged && !colorChanged) return;
      
      prevHcRef.current = userHeadCircumference;
      prevBudgetRef.current = maxBudget;
      prevColorRef.current = preferredColor;

      const fetchRecs = async () => {
        setIsLoadingRecs(true);
        try {
          const hcVal = validateHeadCircumference(userHeadCircumference);
          let userHcMm = null;
          let hcSource = "camera_unavailable";
          if (hcVal.isValid) {
            userHcMm = hcVal.valueCm * 10.0;
            hcSource = "user_entered";
          } else if (headCircumferenceResult?.status === "estimated" && headCircumferenceResult?.circumference_mm) {
            userHcMm = headCircumferenceResult.circumference_mm;
            hcSource = "ai_three_view";
          }

          const leftEarMm = leftSideResult?.measurements?.eye_to_ear_distance_mm || null;
          const rightEarMm = rightSideResult?.measurements?.eye_to_ear_distance_mm || null;
          const estTempleMm = rightSideResult?.measurements?.estimated_temple_length_mm || 
                              leftSideResult?.measurements?.estimated_temple_length_mm || null;
          
          let sideStatus = 'none';
          if (leftSideResult?.status === 'valid' && rightSideResult?.status === 'valid') sideStatus = 'both_captured';
          else if (rightSideResult?.status === 'valid') sideStatus = 'right_captured';
          else if (leftSideResult?.status === 'valid') sideStatus = 'left_captured';

          const reqBody = {
            face_shape: phase1Result.face_shape,
            face_shape_confidence: phase1Result.confidence,
            ipd_mm: phase2Result.ipd?.ipd_mm || 63.0,
            ipd_method: phase2Result.ipd?.method || "estimated",
            skin_tone: phase2Result.skin_tone?.skin_tone || "Medium",
            undertone: phase2Result.skin_tone?.undertone || "Neutral",
            budget: maxBudget && !isNaN(parseFloat(maxBudget)) ? parseFloat(maxBudget) : null,
            preferred_color: preferredColor.trim() || null,
            eye_shape: phase2Result.eye_shape?.eye_shape || "Undetermined",
            eye_shape_confidence: phase2Result.eye_shape?.eye_shape_confidence || null,
            head_circumference_mm: userHcMm,
            head_circumference_source: hcSource,
            face_width_mm: phase2Result.measurements?.cheekbone_width_mm || null,
            left_eye_to_ear_mm: leftEarMm,
            right_eye_to_ear_mm: rightEarMm,
            estimated_temple_length_mm: estTempleMm,
            side_view_status: sideStatus
          };
          
          const res = await axios.post(`${API_BASE}/api/recommendations`, reqBody);
          setRecommendations(res.data.recommendations);
        } catch (err) {
          console.error("Failed to re-fetch recommendations:", err);
        } finally {
          setIsLoadingRecs(false);
        }
      };
      fetchRecs();
    }
  }, [showResults, phase1Result, phase2Result, userHeadCircumference, maxBudget, preferredColor, leftSideResult, rightSideResult, headCircumferenceResult, catalogVersion]);

  // Clean up streams and loops on unmount
  useEffect(() => {
    return () => {
      stopCameraAndMesh();
    };
  }, []);

  // Pre-warm SpeechSynthesis voices
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.getVoices();
        };
      }
    }
  }, []);

  // Ensure video element receives the stream and stays in sync across re-renders
  useEffect(() => {
    if (videoRef.current && stream) {
      const video = videoRef.current;
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.play().catch(e => console.warn("Video stream play() sync error:", e));
      }
    }
  }, [stream]);

  const stopCameraAndMesh = () => {
    activeLoopRef.current = false;
    resetGuidanceTracking();
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch (e) {}
      videoRef.current.srcObject = null;
    }
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      activeStreamRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      setStream(null);
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
  };

  // Secure Logout: clears session token, state, and terminates any active camera
  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setWelcomeNotice(null);
    localStorage.removeItem('smartframe_token');
    try {
      stopCameraAndMesh();
    } catch (_) {}
    setActiveView('catalog');
  }, []);

  const captureCanvasBlobAsync = () => {
    return new Promise((resolve) => {
      if (!videoRef.current || !canvasRef.current) {
        resolve(null);
        return;
      }
      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        resolve(null);
        return;
      }
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  };

  const initFaceMesh = () => {
    if (!window.FaceMesh) {
      console.warn("MediaPipe FaceMesh not loaded from CDN yet");
      return null;
    }
    const fm = new window.FaceMesh({
      locateFile: (file) => `/mediapipe/face_mesh/${file}`
    });
    fm.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    return fm;
  };

  // Real-time Pose & Stability Tracking
  const handleFaceMeshResults = async (results) => {
    const currentState = sessionStateRef.current;
    
    const isFront = [
      SMART_GUIDED_STATES.WAITING_FOR_FACE,
      SMART_GUIDED_STATES.CHECKING_FRONT_POSE,
      SMART_GUIDED_STATES.GUIDING_FRONT,
      SMART_GUIDED_STATES.VERIFYING_FRONT_STABILITY,
      SMART_GUIDED_STATES.CAPTURING_FRONT
    ].includes(currentState);

    const isRight = [
      SMART_GUIDED_STATES.GUIDING_RIGHT,
      SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE,
      SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY,
      SMART_GUIDED_STATES.CAPTURING_RIGHT
    ].includes(currentState);

    const isLeft = [
      SMART_GUIDED_STATES.GUIDING_LEFT,
      SMART_GUIDED_STATES.VERIFYING_LEFT_POSE,
      SMART_GUIDED_STATES.VERIFYING_LEFT_STABILITY,
      SMART_GUIDED_STATES.CAPTURING_LEFT
    ].includes(currentState);

    if (!isFront && !isRight && !isLeft) return;
    if (isCapturingFrameRef.current) return;

    // Timeout and recovery check
    const elapsedSeconds = stepStartTimeRef.current > 0 ? (Date.now() - stepStartTimeRef.current) / 1000 : 0;
    if (elapsedSeconds > 18 && !reminderSpokenRef.current && stepStartTimeRef.current > 0) {
      reminderSpokenRef.current = true;
      if (isFront) {
        speakVoice("Look directly at the camera.");
      } else if (isLeft) {
        speakVoice("Slowly turn your head to the left.");
      } else if (isRight) {
        speakVoice("Slowly turn your head to the right.");
      }
    }

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (isFront && currentState !== SMART_GUIDED_STATES.WAITING_FOR_FACE) {
        setSessionState(SMART_GUIDED_STATES.WAITING_FOR_FACE);
        sessionStateRef.current = SMART_GUIDED_STATES.WAITING_FOR_FACE;
      }
      setPoseStatus('Waiting for face');
      setLiveGuidance({
        main: isFront 
          ? 'Front View: Look directly at the camera.' 
          : isLeft 
          ? 'Left View: Slowly turn your head to the left.' 
          : 'Right View: Slowly turn your head to the right.',
        corrective: false
      });
      stabilityCountRef.current = 0;
      sideStabilityStartTimeRef.current = 0;
      sideJitterFramesRef.current = 0;
      setStabilityProgress(0);
      return;
    }

    const lm = results.multiFaceLandmarks[0];
    const nose = lm[1];
    const rightEye = lm[33];   // Anatomical right outer corner
    const leftEye = lm[263];   // Anatomical left outer corner
    
    if (!nose || !rightEye || !leftEye) return;

    // 0. POSE, VELOCITY & LANDMARK COMPUTATIONS
    const chin = lm[152];
    const forehead = lm[10];

    // Compute real 3D head pose (yaw, pitch, roll in degrees)
    const { yaw: rawYaw, pitch: rawPitch, roll: rawRoll } = estimateHeadPoseFromLandmarks(
      lm,
      videoRef.current?.videoWidth || 1280,
      videoRef.current?.videoHeight || 720
    );

    // Smooth head motion velocity
    const now = performance.now();
    const dt = prevNosePosRef.current.time > 0 ? (now - prevNosePosRef.current.time) / 1000 : 0.033;
    const dx = nose.x - prevNosePosRef.current.x;
    const dy = nose.y - prevNosePosRef.current.y;
    const instVel = Math.hypot(dx, dy) / Math.max(0.016, dt);
    smoothVelocityRef.current = 0.35 * instVel + 0.65 * smoothVelocityRef.current;
    prevNosePosRef.current = { x: nose.x, y: nose.y, time: now };
    const isMovingTooMuch = smoothVelocityRef.current > GUIDANCE_CONFIG.MAX_STABLE_VELOCITY;

    // Smooth yaw angle without lag (0.40 raw + 0.60 smoothed)
    smoothRatioRef.current = smoothRatioRef.current === 0 
      ? rawYaw 
      : (0.40 * rawYaw + 0.60 * smoothRatioRef.current);
    const estimatedYaw = Math.round(smoothRatioRef.current * 10) / 10;

    // Classify user's actual physical pose
    let detectedPose = 'FRONT';
    if (estimatedYaw <= -18.0) {
      detectedPose = 'LEFT';
    } else if (estimatedYaw >= 18.0) {
      detectedPose = 'RIGHT';
    } else {
      detectedPose = 'FRONT';
    }

    const inMargin = (p) => p && p.x >= GUIDANCE_CONFIG.MARGIN_MIN && p.x <= GUIDANCE_CONFIG.MARGIN_MAX && p.y >= GUIDANCE_CONFIG.MARGIN_MIN && p.y <= GUIDANCE_CONFIG.MARGIN_MAX;

    // 1. STEP 1: FRONT VIEW (WAITING_FOR_POSE -> TARGET_REACHED -> SPEAKING_HOLD_INSTRUCTION -> VERIFYING_STABILITY -> CAPTURING -> CAPTURE_COMPLETE)
    if (isFront) {
      const faceHeight = Math.hypot(chin.x - forehead.x, chin.y - forehead.y);
      const isCentered = nose.x >= GUIDANCE_CONFIG.CENTER_MIN_X && nose.x <= GUIDANCE_CONFIG.CENTER_MAX_X;
      const isTooClose = faceHeight > GUIDANCE_CONFIG.TOO_CLOSE_FACE_HEIGHT;
      const isLightingOk = checkLighting();
      const isFacingFront = Math.abs(estimatedYaw) <= GUIDANCE_CONFIG.FRONT_MAX_YAW;
      const headLevel = Math.abs(rawRoll) < 16.0 || Math.abs(rightEye.y - leftEye.y) < 0.08;
      const frontLandmarksVisible = inMargin(rightEye) && inMargin(leftEye) && inMargin(nose) && inMargin(chin) && inMargin(forehead);
      const frontPoseValid = isFacingFront && headLevel && frontLandmarksVisible && isCentered && !isTooClose && isLightingOk && !isMovingTooMuch;

      let frontRejection = 'None';
      if (!isLightingOk) frontRejection = 'POOR_LIGHTING';
      else if (!isCentered) frontRejection = 'NOT_CENTERED';
      else if (isTooClose) frontRejection = 'TOO_CLOSE';
      else if (isMovingTooMuch) frontRejection = `MOVING_FAST (${smoothVelocityRef.current.toFixed(2)})`;
      else if (!isFacingFront) frontRejection = `TURNED (${estimatedYaw > 0 ? '+' : ''}${estimatedYaw}°)`;
      else if (!headLevel) frontRejection = 'HEAD_TILTED';
      else if (!frontLandmarksVisible) frontRejection = 'LANDMARK_OUT_OF_BOUNDS';

      updateDebugHud({
        currentStep: 'FRONT (1/3)',
        detectedPose,
        estimatedYaw,
        eyeRatio: Math.round(estimatedYaw),
        requiredPoseReached: frontPoseValid,
        landmarkQuality: frontLandmarksVisible ? 'PASS' : 'FAIL',
        landmarkDetails: frontLandmarksVisible ? 'All 5 key points in bounds' : 'Eye/Nose/Chin out of bounds',
        captureStatus: captureSubStateRef.current,
        rejectionReason: frontRejection
      });

      // 1A. Waiting for target pose
      if (captureSubStateRef.current === CAPTURE_SUBSTATES.WAITING_FOR_POSE) {
        if (!frontPoseValid) {
          targetPoseCandidateFramesRef.current = 0;
          stabilityCountRef.current = 0;
          setStabilityProgress(0);

          if (!isLightingOk) {
            if (currentState !== SMART_GUIDED_STATES.GUIDING_FRONT) {
              setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
              sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
            }
            setPoseStatus('Adjust your head position');
            setLiveGuidance({
              main: 'Adjust your position: Please improve the lighting on your face.',
              corrective: true
            });
            speakAdaptiveGuidance(GUIDANCE_STATES.POOR_LIGHTING, "Please improve the lighting on your face.");
          } else if (!isCentered) {
            if (currentState !== SMART_GUIDED_STATES.GUIDING_FRONT) {
              setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
              sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
            }
            setPoseStatus('Adjust your head position');
            setLiveGuidance({
              main: 'Adjust your position: Keep your face centered in frame.',
              corrective: true
            });
            speakAdaptiveGuidance(GUIDANCE_STATES.NOT_CENTERED, "Keep your face centered.");
          } else if (!isFacingFront) {
            if (currentState !== SMART_GUIDED_STATES.GUIDING_FRONT) {
              setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
              sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
            }
            setPoseStatus('Adjust your head position');
            setLiveGuidance({
              main: 'Front View: Look directly at the camera.',
              corrective: true
            });
            speakAdaptiveGuidance(GUIDANCE_STATES.WAITING_FOR_TURN, "Look directly at the camera.");
          } else if (!headLevel) {
            if (currentState !== SMART_GUIDED_STATES.GUIDING_FRONT) {
              setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
              sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
            }
            setPoseStatus('Adjust your head position');
            setLiveGuidance({
              main: 'Adjust your position: Keep your head level.',
              corrective: true
            });
            speakAdaptiveGuidance(GUIDANCE_STATES.LANDMARKS_OBSCURED, "Keep your head level.");
          } else if (isTooClose) {
            if (currentState !== SMART_GUIDED_STATES.GUIDING_FRONT) {
              setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
              sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
            }
            setPoseStatus('Adjust your head position');
            setLiveGuidance({
              main: 'Adjust your position: Move back slightly to keep face visible.',
              corrective: true
            });
            speakAdaptiveGuidance(GUIDANCE_STATES.TOO_CLOSE, "Move back slightly to keep your face clearly visible.");
          } else if (isMovingTooMuch) {
            if (currentState !== SMART_GUIDED_STATES.GUIDING_FRONT) {
              setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
              sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
            }
            setPoseStatus('Adjust your head position');
            setLiveGuidance({
              main: 'Adjust your position: Keep your head still for a moment.',
              corrective: true
            });
            speakAdaptiveGuidance(GUIDANCE_STATES.MOVING_TOO_MUCH, "Keep your head still for a moment.");
          } else {
            if (currentState !== SMART_GUIDED_STATES.CHECKING_FRONT_POSE) {
              setSessionState(SMART_GUIDED_STATES.CHECKING_FRONT_POSE);
              sessionStateRef.current = SMART_GUIDED_STATES.CHECKING_FRONT_POSE;
            }
            setPoseStatus('Face detected');
            setLiveGuidance({
              main: 'Front View: Look directly at the camera.',
              corrective: false
            });
            speakAdaptiveGuidance(GUIDANCE_STATES.WAITING_FOR_TURN, "Look directly at the camera.");
          }
        } else {
          // Pose valid! Require 2 frames debounce
          targetPoseCandidateFramesRef.current += 1;
          if (targetPoseCandidateFramesRef.current >= 2) {
            targetPoseCandidateFramesRef.current = 0;
            captureSubStateRef.current = CAPTURE_SUBSTATES.SPEAKING_HOLD_INSTRUCTION;
            setSessionState(SMART_GUIDED_STATES.VERIFYING_FRONT_STABILITY);
            sessionStateRef.current = SMART_GUIDED_STATES.VERIFYING_FRONT_STABILITY;
            stabilityCountRef.current = 0;
            setStabilityProgress(0);
            setPoseStatus('Correct position detected');
            setLiveGuidance({
              main: 'Correct position detected. Hold still.',
              corrective: false
            });

            speakHoldInstruction("Hold still.", () => {
              if (!holdCancelledRef.current && sessionStateRef.current === SMART_GUIDED_STATES.VERIFYING_FRONT_STABILITY) {
                captureSubStateRef.current = CAPTURE_SUBSTATES.VERIFYING_STABILITY;
                stabilityCountRef.current = 0;
              }
            });
          }
        }
      }

      // 1B. Speaking hold instruction ("Hold still.")
      else if (captureSubStateRef.current === CAPTURE_SUBSTATES.SPEAKING_HOLD_INSTRUCTION) {
        if (!frontPoseValid) {
          cancelHoldInstruction();
          setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
          setStabilityProgress(0);
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Front View: Look directly at the camera.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.WAITING_FOR_TURN, "Look directly at the camera.", true);
        } else {
          setPoseStatus('Correct position detected');
          setLiveGuidance({
            main: 'Correct position detected. Hold still.',
            corrective: false
          });
        }
      }

      // 1C. Verifying stability (after speech finishes: 600–800ms)
      else if (captureSubStateRef.current === CAPTURE_SUBSTATES.VERIFYING_STABILITY) {
        if (!frontPoseValid) {
          cancelHoldInstruction();
          setSessionState(SMART_GUIDED_STATES.GUIDING_FRONT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_FRONT;
          setStabilityProgress(0);
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Front View: Look directly at the camera.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.WAITING_FOR_TURN, "Look directly at the camera.", true);
        } else {
          stabilityCountRef.current += 1;
          const progress = Math.min(100, Math.round((stabilityCountRef.current / GUIDANCE_CONFIG.REQUIRED_STABILITY_FRAMES) * 100));
          setStabilityProgress(progress);
          const isNearCapture = stabilityCountRef.current >= (GUIDANCE_CONFIG.REQUIRED_STABILITY_FRAMES * 0.7);
          setPoseStatus(isNearCapture ? 'Capturing image' : 'Correct position detected');
          setLiveGuidance({
            main: isNearCapture ? 'Capturing image...' : 'Correct position detected. Hold still.',
            corrective: false
          });

          // Buffer front blobs for MAD IPD
          if (stabilityCountRef.current % 2 === 0 && capturedBlobsRef.current.frontBlobs.length < 14) {
            captureCanvasBlobAsync().then(blob => {
              if (blob && capturedBlobsRef.current.frontBlobs.length < 14) {
                capturedBlobsRef.current.frontBlobs.push(blob);
              }
            });
          }

          if (stabilityCountRef.current >= GUIDANCE_CONFIG.REQUIRED_STABILITY_FRAMES) {
            captureSubStateRef.current = CAPTURE_SUBSTATES.CAPTURING;
            isCapturingFrameRef.current = true;
            setPoseStatus('Capturing image');
            playCaptureChime();
            setFlashActive(true);

            let primaryBlob = capturedBlobsRef.current.frontBlobs[0];
            if (!primaryBlob) {
              primaryBlob = await captureCanvasBlobAsync();
              if (primaryBlob) capturedBlobsRef.current.frontBlobs.push(primaryBlob);
            }
            if (primaryBlob) {
              setCapturedImage(URL.createObjectURL(primaryBlob));
            }

            captureSubStateRef.current = CAPTURE_SUBSTATES.CAPTURE_COMPLETE;
            setSessionState(SMART_GUIDED_STATES.CAPTURING_FRONT);
            sessionStateRef.current = SMART_GUIDED_STATES.CAPTURING_FRONT;
            setPoseStatus('Capture successful');
            setLiveGuidance({
              main: 'Front view captured successfully.',
              corrective: false
            });

            setFlashActive(false);
            resetGuidanceTracking();
            setStabilityProgress(0);
            stepStartTimeRef.current = Date.now();
            reminderSpokenRef.current = false;
            lastSpokenWrongTurnRef.current = 0;
            lastSpokenPartialTurnRef.current = 0;
            isCapturingFrameRef.current = false;

            if (straightFaceOnlyRef.current) {
              stopCameraAndMesh();
              speakVoice("Front view captured. Analyzing face.", null, true);
              setSessionState(AUTO_STATES.PROCESSING);
              runAutomaticAnalysis();
              return;
            }

            // Standard 3-View workflow: Advance to Step 2: Left View
            setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
            sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
            captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
            setPoseStatus('Face detected');
            setLiveGuidance({
              main: 'Left View: Slowly turn your head fully to the left.',
              corrective: false
            });

            speakVoice("Front view captured. Slowly turn your head fully to the left.", null, true);
            lastSpokenStateRef.current = GUIDANCE_STATES.INITIAL;
            lastSpokenTimeRef.current = Date.now();
          }
        }
      }
    }

    // 2. STEP 2: LEFT-SIDE PROFILE (Slowly turn your head fully to the left)
    else if (isLeft) {
      // In physical LEFT turn:
      // Head rotates to user's left: anatomical right ear (234) and right eye (33) FACE the camera!
      // Anatomical left ear (454) and left eye (263) turn away behind the head.
      const visibleEar = lm[234];
      const visibleEye = lm[33];
      const earOk = inMargin(visibleEar);
      const eyeOk = inMargin(visibleEye);
      const noseOk = inMargin(nose);
      const chinOk = inMargin(chin);
      const earSeparation = Math.abs(visibleEar.x - visibleEye.x);
      const earSeparationOk = earOk && eyeOk && earSeparation >= 0.015;
      const leftLandmarksVisible = earOk && eyeOk && noseOk && chinOk && earSeparationOk;

      // Real physical head yaw in degrees (negative = turned left, matching backend solvePnP)
      const inLeftTargetRange = estimatedYaw <= -GUIDANCE_CONFIG.PROFILE_MIN_YAW && estimatedYaw >= -GUIDANCE_CONFIG.PROFILE_MAX_YAW;
      const isApproaching = estimatedYaw <= -GUIDANCE_CONFIG.APPROACHING_YAW && estimatedYaw > -GUIDANCE_CONFIG.PROFILE_MIN_YAW;
      const isTooFar = estimatedYaw < -GUIDANCE_CONFIG.TOO_FAR_YAW;
      const isFacingFront = Math.abs(estimatedYaw) <= GUIDANCE_CONFIG.FRONT_MAX_YAW;
      const isWrongDirection = estimatedYaw > GUIDANCE_CONFIG.WRONG_DIR_YAW; // Turned right (+15° or more)
      const isBarelyTurned = estimatedYaw < -GUIDANCE_CONFIG.FRONT_MAX_YAW && estimatedYaw > -GUIDANCE_CONFIG.APPROACHING_YAW;

      const leftPoseValid = inLeftTargetRange && leftLandmarksVisible && !isMovingTooMuch;

      let leftRejection = 'None';
      if (isFacingFront) leftRejection = 'FACING_FRONT: Turn head left';
      else if (isWrongDirection) leftRejection = `WRONG_DIRECTION: Turned right (+${estimatedYaw}°)`;
      else if (isBarelyTurned) leftRejection = `INSUFFICIENT_TURN (${estimatedYaw}° > -32°)`;
      else if (isApproaching) leftRejection = `APPROACHING (${estimatedYaw}°: turn to ~65°–80°)`;
      else if (isTooFar) leftRejection = `EXCESSIVE_TURN (${estimatedYaw}° < -86°)`;
      else if (!leftLandmarksVisible) {
        leftRejection = !earOk ? 'FAIL: Ear out of frame' : !eyeOk ? 'FAIL: Eye out of frame' : !earSeparationOk ? 'FAIL: Ear/eye collapsed' : 'FAIL: Face margin';
      } else if (isMovingTooMuch) {
        leftRejection = `FAIL: Moving fast (${smoothVelocityRef.current.toFixed(2)})`;
      }

      updateDebugHud({
        currentStep: singleCaptureSideRef.current === 'left' ? 'RETAKE LEFT (2/3)' : 'LEFT VIEW (2/3)',
        detectedPose,
        estimatedYaw,
        eyeRatio: Math.round(estimatedYaw),
        requiredPoseReached: leftPoseValid,
        landmarkQuality: leftLandmarksVisible ? 'PASS' : 'FAIL',
        landmarkDetails: `Ear sep: ${(earSeparation * 100).toFixed(1)}% | Ear:${earOk?'OK':'OUT'} Eye:${eyeOk?'OK':'OUT'}`,
        captureStatus: leftPoseValid ? (captureSubStateRef.current === CAPTURE_SUBSTATES.VERIFYING_STABILITY ? `HOLDING (${stabilityCountRef.current}/${GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES})` : 'CONFIRMING') : 'ADJUSTING',
        rejectionReason: leftRejection
      });

      if (!leftPoseValid) {
        sideJitterFramesRef.current += 1;
        if (sideJitterFramesRef.current > 3 || isFacingFront || isWrongDirection) {
          stabilityCountRef.current = 0;
          sideStabilityStartTimeRef.current = 0;
          captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
          setStabilityProgress(0);
        }

        if (isFacingFront) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
          setPoseStatus('Face detected');
          setLiveGuidance({
            main: 'Left View: Slowly turn your head fully to the left.',
            corrective: false
          });
        } else if (isWrongDirection) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Adjust your head position: Slowly turn your head fully to the left.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.WRONG_DIRECTION, "Slowly turn your head fully to the left.");
        } else if (isTooFar) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Adjust your head position: Turn slightly back toward center.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.TOO_FAR, "Turn slightly back.");
        } else if (inLeftTargetRange && !leftLandmarksVisible) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Adjust your head position: Keep your face and ear clearly visible in frame.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.LANDMARKS_OBSCURED, "Keep your face and ear clearly visible in frame.");
        } else if (inLeftTargetRange && isMovingTooMuch) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
          setPoseStatus('Hold still');
          setLiveGuidance({
            main: 'Hold still: Keep your head steady in side position.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.MOVING_TOO_MUCH, "Keep your head steady in side position.");
        } else if (isApproaching || isBarelyTurned) {
          setSessionState(SMART_GUIDED_STATES.VERIFYING_LEFT_POSE);
          sessionStateRef.current = SMART_GUIDED_STATES.VERIFYING_LEFT_POSE;
          setPoseStatus('Turn further');
          setLiveGuidance({
            main: 'Turn further: Slowly turn your head to the left (~65°–80°).',
            corrective: false
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.APPROACHING, "Turn further to the left.");
        } else {
          setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
          setPoseStatus('Turn further');
          setLiveGuidance({
            main: 'Left View: Slowly turn your head to the left.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.BARELY_TURNED, "Slowly turn your head to the left.");
        }
      } else {
        // Left pose valid (60°–86° target profile)!
        sideJitterFramesRef.current = 0;
        if (captureSubStateRef.current !== CAPTURE_SUBSTATES.VERIFYING_STABILITY) {
          captureSubStateRef.current = CAPTURE_SUBSTATES.VERIFYING_STABILITY;
          sideStabilityStartTimeRef.current = Date.now();
          stabilityCountRef.current = 1;
          setSessionState(SMART_GUIDED_STATES.VERIFYING_LEFT_STABILITY);
          sessionStateRef.current = SMART_GUIDED_STATES.VERIFYING_LEFT_STABILITY;
          setPoseStatus('Correct side position');
          setLiveGuidance({
            main: 'Correct side position. Hold still.',
            corrective: false
          });
          const progress = Math.min(100, Math.round((1 / GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES) * 100));
          setStabilityProgress(progress);
          speakAdaptiveGuidance(GUIDANCE_STATES.TARGET_REACHED, "Hold still.");
        } else {
          stabilityCountRef.current += 1;
          const elapsedMs = Date.now() - sideStabilityStartTimeRef.current;
          const progress = Math.min(100, Math.round((stabilityCountRef.current / GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES) * 100));
          setStabilityProgress(progress);

          if (stabilityCountRef.current >= Math.ceil(GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES * 0.85)) {
            setPoseStatus('Capturing');
            setLiveGuidance({
              main: 'Capturing...',
              corrective: false
            });
          } else {
            setPoseStatus('Hold still');
            setLiveGuidance({
              main: 'Hold still...',
              corrective: false
            });
          }

          // Require full stability duration (1.5 to 2.0 seconds: min 48 frames and min 1600ms)
          if (stabilityCountRef.current >= GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES && elapsedMs >= GUIDANCE_CONFIG.SIDE_MIN_STABILITY_MS) {
            if (isCapturingFrameRef.current) return;
            isCapturingFrameRef.current = true;
            captureSubStateRef.current = CAPTURE_SUBSTATES.CAPTURING;
            setPoseStatus('Capturing');
            playCaptureChime();
            setFlashActive(true);

            const leftBlob = await captureCanvasBlobAsync();
            if (!leftBlob || leftBlob.size < 500) {
              console.warn("Failed to capture left blob from canvas");
              isCapturingFrameRef.current = false;
              captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
              setFlashActive(false);
              return;
            }

            capturedBlobsRef.current.leftBlob = leftBlob;
            setCapturedLeftImage(URL.createObjectURL(leftBlob));

            captureSubStateRef.current = CAPTURE_SUBSTATES.CAPTURE_COMPLETE;
            setSessionState(SMART_GUIDED_STATES.CAPTURING_LEFT);
            sessionStateRef.current = SMART_GUIDED_STATES.CAPTURING_LEFT;
            setPoseStatus('Capture successful');
            setLiveGuidance({
              main: 'Left view captured successfully.',
              corrective: false
            });

            if (singleCaptureSideRef.current === 'left') {
              setFlashActive(false);
              stopCameraAndMesh();
              speakVoice("Left profile updated.", null, true);
              runSingleSideAnalysis('left', leftBlob);
              return;
            }

            // Standard workflow: advance to Step 3: Right View
            setFlashActive(false);
            resetGuidanceTracking();
            setStabilityProgress(0);
            stepStartTimeRef.current = Date.now();
            reminderSpokenRef.current = false;
            lastSpokenWrongTurnRef.current = 0;
            lastSpokenPartialTurnRef.current = 0;
            turnTransitionUntilRef.current = Date.now() + 1500;
            isCapturingFrameRef.current = false;

            setSessionState(SMART_GUIDED_STATES.GUIDING_RIGHT);
            sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_RIGHT;
            captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
            setPoseStatus('Face detected');
            setLiveGuidance({
              main: 'Right View: Slowly turn your head fully to the right.',
              corrective: false
            });

            speakVoice("Left view captured. Slowly turn your head fully to the right.", null, true);
            lastSpokenStateRef.current = GUIDANCE_STATES.INITIAL;
            lastSpokenTimeRef.current = Date.now();
          }
        }
      }
    }

    // 3. STEP 3: RIGHT-SIDE PROFILE (Slowly turn your head fully to the right)
    else if (isRight) {
      // In physical RIGHT turn:
      // Head rotates to user's right: anatomical left ear (454) and left eye (263) FACE the camera!
      // Anatomical right ear (234) and right eye (33) turn away behind the head.
      const visibleEar = lm[454];
      const visibleEye = lm[263];
      const earOk = inMargin(visibleEar);
      const eyeOk = inMargin(visibleEye);
      const noseOk = inMargin(nose);
      const chinOk = inMargin(chin);
      const earSeparation = Math.abs(visibleEar.x - visibleEye.x);
      const earSeparationOk = earOk && eyeOk && earSeparation >= 0.015;
      const rightLandmarksVisible = earOk && eyeOk && noseOk && chinOk && earSeparationOk;

      // Real physical head yaw in degrees (positive = turned right, matching backend solvePnP)
      const inRightTargetRange = estimatedYaw >= GUIDANCE_CONFIG.PROFILE_MIN_YAW && estimatedYaw <= GUIDANCE_CONFIG.PROFILE_MAX_YAW;
      const isApproaching = estimatedYaw >= GUIDANCE_CONFIG.APPROACHING_YAW && estimatedYaw < GUIDANCE_CONFIG.PROFILE_MIN_YAW;
      const isTooFar = estimatedYaw > GUIDANCE_CONFIG.TOO_FAR_YAW;
      const isFacingFront = Math.abs(estimatedYaw) <= GUIDANCE_CONFIG.FRONT_MAX_YAW;
      const isTransitioning = Date.now() < turnTransitionUntilRef.current;
      const isWrongDirection = !isTransitioning && estimatedYaw < -GUIDANCE_CONFIG.WRONG_DIR_YAW; // Turned left (< -15°) after transition
      const isBarelyTurned = estimatedYaw > GUIDANCE_CONFIG.FRONT_MAX_YAW && estimatedYaw < GUIDANCE_CONFIG.APPROACHING_YAW;

      const rightPoseValid = inRightTargetRange && rightLandmarksVisible && !isMovingTooMuch;

      let rightRejection = 'None';
      if (isFacingFront) rightRejection = 'FACING_FRONT: Turn head right';
      else if (isWrongDirection) rightRejection = `WRONG_DIRECTION: Turned left (${estimatedYaw}°)`;
      else if (isBarelyTurned) rightRejection = `INSUFFICIENT_TURN (${estimatedYaw}° < 32°)`;
      else if (isApproaching) rightRejection = `APPROACHING (${estimatedYaw}°: turn to ~65°–80°)`;
      else if (isTooFar) rightRejection = `EXCESSIVE_TURN (${estimatedYaw}° > 86°)`;
      else if (!rightLandmarksVisible) {
        rightRejection = !earOk ? 'FAIL: Ear out of frame' : !eyeOk ? 'FAIL: Eye out of frame' : !earSeparationOk ? 'FAIL: Ear/eye collapsed' : 'FAIL: Face margin';
      } else if (isMovingTooMuch) {
        rightRejection = `FAIL: Moving fast (${smoothVelocityRef.current.toFixed(2)})`;
      }

      updateDebugHud({
        currentStep: singleCaptureSideRef.current === 'right' ? 'RETAKE RIGHT (3/3)' : 'RIGHT VIEW (3/3)',
        detectedPose,
        estimatedYaw,
        eyeRatio: Math.round(estimatedYaw),
        requiredPoseReached: rightPoseValid,
        landmarkQuality: rightLandmarksVisible ? 'PASS' : 'FAIL',
        landmarkDetails: `Ear sep: ${(earSeparation * 100).toFixed(1)}% | Ear:${earOk?'OK':'OUT'} Eye:${eyeOk?'OK':'OUT'}`,
        captureStatus: rightPoseValid ? (captureSubStateRef.current === CAPTURE_SUBSTATES.VERIFYING_STABILITY ? `HOLDING (${stabilityCountRef.current}/${GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES})` : 'CONFIRMING') : 'ADJUSTING',
        rejectionReason: rightRejection
      });

      if (!rightPoseValid) {
        sideJitterFramesRef.current += 1;
        if (sideJitterFramesRef.current > 3 || isFacingFront || isWrongDirection) {
          stabilityCountRef.current = 0;
          sideStabilityStartTimeRef.current = 0;
          captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
          setStabilityProgress(0);
        }

        if (isFacingFront || (isTransitioning && estimatedYaw < 0)) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_RIGHT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_RIGHT;
          setPoseStatus('Face detected');
          setLiveGuidance({
            main: 'Right View: Slowly turn your head fully to the right.',
            corrective: false
          });
        } else if (isWrongDirection) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_RIGHT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_RIGHT;
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Adjust your head position: Slowly turn your head fully to the right.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.WRONG_DIRECTION, "Slowly turn your head fully to the right.");
        } else if (isTooFar) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_RIGHT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_RIGHT;
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Adjust your head position: Turn slightly back toward center.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.TOO_FAR, "Turn slightly back.");
        } else if (inRightTargetRange && !rightLandmarksVisible) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_RIGHT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_RIGHT;
          setPoseStatus('Adjust your head position');
          setLiveGuidance({
            main: 'Adjust your head position: Keep your face and ear visible in frame.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.LANDMARKS_OBSCURED, "Keep your face and ear visible in frame.");
        } else if (inRightTargetRange && isMovingTooMuch) {
          setSessionState(SMART_GUIDED_STATES.GUIDING_RIGHT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_RIGHT;
          setPoseStatus('Hold still');
          setLiveGuidance({
            main: 'Hold still: Keep your head steady in side position.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.MOVING_TOO_MUCH, "Keep your head steady in side position.");
        } else if (isApproaching || isBarelyTurned) {
          setSessionState(SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE);
          sessionStateRef.current = SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE;
          setPoseStatus('Turn further');
          setLiveGuidance({
            main: 'Turn further: Slowly turn your head to the right (~65°–80°).',
            corrective: false
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.APPROACHING, "Turn further to the right.");
        } else {
          setSessionState(SMART_GUIDED_STATES.GUIDING_RIGHT);
          sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_RIGHT;
          setPoseStatus('Turn further');
          setLiveGuidance({
            main: 'Right View: Slowly turn your head to the right.',
            corrective: true
          });
          speakAdaptiveGuidance(GUIDANCE_STATES.BARELY_TURNED, "Slowly turn your head to the right.");
        }
      } else {
        // Right pose valid (60°–86° target profile)!
        sideJitterFramesRef.current = 0;
        if (captureSubStateRef.current !== CAPTURE_SUBSTATES.VERIFYING_STABILITY) {
          captureSubStateRef.current = CAPTURE_SUBSTATES.VERIFYING_STABILITY;
          sideStabilityStartTimeRef.current = Date.now();
          stabilityCountRef.current = 1;
          setSessionState(SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY);
          sessionStateRef.current = SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY;
          setPoseStatus('Correct side position');
          setLiveGuidance({
            main: 'Correct side position. Hold still.',
            corrective: false
          });
          const progress = Math.min(100, Math.round((1 / GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES) * 100));
          setStabilityProgress(progress);
          speakAdaptiveGuidance(GUIDANCE_STATES.TARGET_REACHED, "Hold still.");
        } else {
          stabilityCountRef.current += 1;
          const elapsedMs = Date.now() - sideStabilityStartTimeRef.current;
          const progress = Math.min(100, Math.round((stabilityCountRef.current / GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES) * 100));
          setStabilityProgress(progress);

          if (stabilityCountRef.current >= Math.ceil(GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES * 0.85)) {
            setPoseStatus('Capturing');
            setLiveGuidance({
              main: 'Capturing...',
              corrective: false
            });
          } else {
            setPoseStatus('Hold still');
            setLiveGuidance({
              main: 'Hold still...',
              corrective: false
            });
          }

          // Require full stability duration (1.5 to 2.0 seconds: min 48 frames and min 1600ms)
          if (stabilityCountRef.current >= GUIDANCE_CONFIG.SIDE_REQUIRED_STABILITY_FRAMES && elapsedMs >= GUIDANCE_CONFIG.SIDE_MIN_STABILITY_MS) {
            if (isCapturingFrameRef.current) return;
            isCapturingFrameRef.current = true;
            captureSubStateRef.current = CAPTURE_SUBSTATES.CAPTURING;
            setPoseStatus('Capturing');
            playCaptureChime();
            setFlashActive(true);

            const rightBlob = await captureCanvasBlobAsync();
            if (!rightBlob || rightBlob.size < 500) {
              console.warn("Failed to capture right blob from canvas");
              isCapturingFrameRef.current = false;
              captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
              setFlashActive(false);
              return;
            }

            capturedBlobsRef.current.rightBlob = rightBlob;
            setCapturedRightImage(URL.createObjectURL(rightBlob));

            captureSubStateRef.current = CAPTURE_SUBSTATES.CAPTURE_COMPLETE;
            setSessionState(SMART_GUIDED_STATES.CAPTURING_RIGHT);
            sessionStateRef.current = SMART_GUIDED_STATES.CAPTURING_RIGHT;
            setPoseStatus('Capture successful');
            setLiveGuidance({
              main: 'Right view captured successfully.',
              corrective: false
            });

            if (singleCaptureSideRef.current === 'right') {
              setFlashActive(false);
              stopCameraAndMesh();
              speakVoice("Right profile updated.", null, true);
              runSingleSideAnalysis('right', rightBlob);
              return;
            }

            // Standard workflow: process all 3 views
            setFlashActive(false);
            stopCameraAndMesh();
            setSessionState(SMART_GUIDED_STATES.PROCESSING);
            sessionStateRef.current = SMART_GUIDED_STATES.PROCESSING;
            setPoseStatus('Capture successful');
            setLiveGuidance({
              main: 'All three views captured successfully. Analyzing your face now.',
              corrective: false
            });

            speakVoice("All views captured successfully. Analyzing your face now.", null, true);
            runAutomaticAnalysis();
          }
        }
      }
    }
  };

  const finishStraightFaceAnalysis = () => {
    if (capturedBlobsRef.current.frontBlobs.length > 0) {
      straightFaceOnlyRef.current = true;
      setScanMode('straight');
      stopCameraAndMesh();
      speakVoice("Analyzing straight face.", null, true);
      setSessionState(AUTO_STATES.PROCESSING);
      runAutomaticAnalysis();
    }
  };

  const returnToDashboard = () => {
    stopCameraAndMesh();
    stabilityCountRef.current = 0;
    sideStabilityStartTimeRef.current = 0;
    setStabilityProgress(0);
    isCapturingFrameRef.current = false;
    setSessionState(SMART_GUIDED_STATES.IDLE);
    sessionStateRef.current = SMART_GUIDED_STATES.IDLE;
    setActiveView('dashboard');
  };

  const startThreeViewReusingFront = async () => {
    straightFaceOnlyRef.current = false;
    setScanMode('three_view');
    setActiveView('scanner');
    setErrorMsg('');
    setSideErrorMsg('');
    setShowResults(false);
    
    // Clear side profile captures and results so they are captured fresh
    setCapturedLeftImage(null);
    setCapturedRightImage(null);
    setLeftSideResult(null);
    setRightSideResult(null);
    setHeadCircumferenceResult(null);
    capturedBlobsRef.current.leftBlob = null;
    capturedBlobsRef.current.rightBlob = null;

    stabilityCountRef.current = 0;
    sideStabilityStartTimeRef.current = 0;
    setStabilityProgress(0);
    isCapturingFrameRef.current = false;

    stopCameraAndMesh();

    setSessionState(SMART_GUIDED_STATES.GUIDING_LEFT);
    sessionStateRef.current = SMART_GUIDED_STATES.GUIDING_LEFT;
    captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;
    setPoseStatus('Face detected');
    setLiveGuidance({
      main: 'Left View: Slowly turn your head to the left (~65°–80°).',
      corrective: false
    });

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 } },
        audio: false
      });
      setStream(mediaStream);
      activeStreamRef.current = mediaStream;
      const video = videoRef.current;
      if (!video) throw new Error("Video element reference missing");
      video.srcObject = mediaStream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      await new Promise(resolve => {
        if (video.readyState >= 1 && video.videoWidth > 0) resolve();
        else {
          const onMeta = () => { video.removeEventListener('loadedmetadata', onMeta); resolve(); };
          video.addEventListener('loadedmetadata', onMeta);
          setTimeout(resolve, 1500);
        }
      });
      try { await video.play(); } catch(e){}

      let fm = faceMeshRef.current;
      if (!fm) {
        fm = initFaceMesh();
        faceMeshRef.current = fm;
      }
      if (fm) {
        fm.onResults(handleFaceMeshResults);
        activeLoopRef.current = true;
        const processLoop = async () => {
          if (!activeLoopRef.current) return;
          if (videoRef.current && videoRef.current.readyState >= 2 && videoRef.current.videoWidth > 0 && faceMeshRef.current) {
            try { await faceMeshRef.current.send({ image: videoRef.current }); } catch (err) {}
          }
          if (activeLoopRef.current) {
            animFrameIdRef.current = requestAnimationFrame(processLoop);
          }
        };
        animFrameIdRef.current = requestAnimationFrame(processLoop);
      }

      speakVoice("Front view saved. Now slowly turn your head to the left.", null, true);
    } catch (err) {
      console.error("Camera startup error:", err);
      setErrorMsg("Failed to access camera: " + err.message);
      setSessionState(SMART_GUIDED_STATES.ERROR);
    }
  };

  const startAutomaticAnalysis = async (straightOnly = false) => {
    straightFaceOnlyRef.current = straightOnly;
    setScanMode(straightOnly ? 'straight' : 'three_view');
    setActiveView('scanner');
    setErrorMsg('');
    setSideErrorMsg('');
    setPhase1Result(null);
    setPhase2Result(null);
    setRightSideResult(null);
    setLeftSideResult(null);
    setHeadCircumferenceResult(null);
    setRecommendations(null);
    setShowResults(false);
    setCapturedImage(null);
    setCapturedRightImage(null);
    setCapturedLeftImage(null);
    faceShapeLocked.current = false;
    
    stabilityCountRef.current = 0;
    sideStabilityStartTimeRef.current = 0;
    setStabilityProgress(0);
    capturedBlobsRef.current = { frontBlobs: [], rightBlob: null, leftBlob: null };
    isCapturingFrameRef.current = false;

    // Stop and release any existing session first
    stopCameraAndMesh();

    setSessionState(SMART_GUIDED_STATES.WAITING_FOR_FACE);
    sessionStateRef.current = SMART_GUIDED_STATES.WAITING_FOR_FACE;

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'user', 
          width: { ideal: 1280, min: 640 }, 
          height: { ideal: 720, min: 480 } 
        },
        audio: false
      });
      
      const videoTracks = mediaStream.getVideoTracks();
      if (!videoTracks || videoTracks.length === 0) {
        throw new Error("No video track found in camera stream.");
      }
      videoTracks[0].enabled = true;

      setStream(mediaStream);
      activeStreamRef.current = mediaStream;
      
      const video = videoRef.current;
      if (!video) {
        throw new Error("Video element reference is not available in DOM.");
      }

      video.srcObject = mediaStream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      // Wait for loadedmetadata and dimensions before starting face detection
      await new Promise((resolve) => {
        if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
          resolve();
        } else {
          const onMeta = () => {
            video.removeEventListener('loadedmetadata', onMeta);
            video.removeEventListener('loadeddata', onMeta);
            resolve();
          };
          video.addEventListener('loadedmetadata', onMeta);
          video.addEventListener('loadeddata', onMeta);
          setTimeout(() => {
            video.removeEventListener('loadedmetadata', onMeta);
            video.removeEventListener('loadeddata', onMeta);
            resolve();
          }, 1500);
        }
      });

      // Safely start playback
      try {
        await video.play();
      } catch (playErr) {
        console.warn("video.play() caught:", playErr);
      }

      let fm = faceMeshRef.current;
      if (!fm) {
        fm = initFaceMesh();
        faceMeshRef.current = fm;
      }
      
      if (fm) {
        fm.onResults(handleFaceMeshResults);
      }

      // Transition to CHECKING_FRONT_POSE now that live video is streaming
      activeLoopRef.current = true;
      setSessionState(SMART_GUIDED_STATES.CHECKING_FRONT_POSE);
      sessionStateRef.current = SMART_GUIDED_STATES.CHECKING_FRONT_POSE;
      setPoseStatus('Position your face');
      setLiveGuidance({
        main: 'Look straight at the camera.',
        corrective: false
      });
      stepStartTimeRef.current = Date.now();
      reminderSpokenRef.current = false;
      lastSpokenWrongTurnRef.current = 0;

      speakVoice("Look straight at the camera.");

      let isProcessingFrame = false;
      const processLoop = async () => {
        if (!activeLoopRef.current) return;
        if (
          !isProcessingFrame && 
          videoRef.current && 
          videoRef.current.readyState >= 2 && 
          videoRef.current.videoWidth > 0 && 
          videoRef.current.videoHeight > 0 &&
          faceMeshRef.current
        ) {
          isProcessingFrame = true;
          try {
            await faceMeshRef.current.send({ image: videoRef.current });
          } catch (e) {
            // Drop frame gracefully
          }
          isProcessingFrame = false;
        }
        if (activeLoopRef.current) {
          animFrameIdRef.current = requestAnimationFrame(processLoop);
        }
      };
      animFrameIdRef.current = requestAnimationFrame(processLoop);

    } catch (err) {
      console.error('Camera access error:', err);
      let msg = 'Camera permission denied or camera unavailable.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Please allow camera permissions in your browser address bar.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera device detected on your system. Please connect a camera or upload a photo.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'Camera is currently in use by another application. Please close other camera applications.';
      } else if (err.message) {
        msg = `Camera error: ${err.message}`;
      }
      setErrorMsg(msg);
      stopCameraAndMesh();
      setSessionState(SMART_GUIDED_STATES.ERROR);
      sessionStateRef.current = SMART_GUIDED_STATES.ERROR;
    }
  };

  const cancelAnalysis = () => {
    stopCameraAndMesh();
    stabilityCountRef.current = 0;
    sideStabilityStartTimeRef.current = 0;
    setStabilityProgress(0);
    isCapturingFrameRef.current = false;
    setSessionState(SMART_GUIDED_STATES.IDLE);
    sessionStateRef.current = SMART_GUIDED_STATES.IDLE;
    setPoseStatus('Position your face');
    setLiveGuidance({
      main: 'Look straight at the camera.',
      corrective: false
    });
  };

  const runAutomaticAnalysis = async () => {
    setIsAnalyzing(true);
    setErrorMsg('');
    setSideErrorMsg('');
    
    let frontBlobs = capturedBlobsRef.current.frontBlobs;
    const rightBlob = capturedBlobsRef.current.rightBlob;
    const leftBlob = capturedBlobsRef.current.leftBlob;
    
    if (frontBlobs.length === 0) {
      setErrorMsg('Failed to capture front image from video session.');
      setIsAnalyzing(false);
      setSessionState(SMART_GUIDED_STATES.IDLE);
      return;
    }

    if (!straightFaceOnlyRef.current) {
      if (!leftBlob || !rightBlob) {
        setErrorMsg('Three-view capture incomplete: left or right profile image was not captured. Please retake the face scan.');
        setIsAnalyzing(false);
        setSessionState(SMART_GUIDED_STATES.IDLE);
        return;
      }
      if (leftBlob === rightBlob) {
        setErrorMsg('Three-view capture error: Duplicate side profile images detected. Please retake the face scan.');
        setIsAnalyzing(false);
        setSessionState(SMART_GUIDED_STATES.IDLE);
        return;
      }
    }

    const primaryFront = frontBlobs[0];

    try {
      // 1. Image Quality Validation
      const fdQuality = new FormData();
      fdQuality.append('image', primaryFront, 'quality.jpg');
      const qualityRes = await axios.post(`${API_BASE}/api/analyze/quality`, fdQuality);
      if (qualityRes.data.quality?.status !== 'valid') {
        setPhase2Result({ quality: qualityRes.data.quality });
        setShowResults(true);
        setSessionState(SMART_GUIDED_STATES.COMPLETE);
        setIsAnalyzing(false);
        return;
      }

      // 2. Phase 1 Face Shape & Phase 2 IPD / Biometrics
      const fdPhase1 = new FormData();
      fdPhase1.append('image', primaryFront, 'primary.jpg');
      const multiFrontFrames = frontBlobs && frontBlobs.length > 0 ? frontBlobs.slice(0, 7) : [primaryFront];
      multiFrontFrames.forEach((blob, idx) => {
        fdPhase1.append('images', blob, `frame_${idx}.jpg`);
      });

      const p1Promise = axios.post(`${API_BASE}/api/analyze/phase1`, fdPhase1).catch(e => ({ data: { error: 'Phase 1 API unavailable' } }));
      
      const phase2Promises = frontBlobs.map(blob => {
        const fd = new FormData();
        fd.append('image', blob, 'frame.jpg');
        return axios.post(`${API_BASE}/api/analyze/phase2`, fd).catch(() => null);
      });

      const [res1, ...res2Array] = await Promise.all([p1Promise, ...phase2Promises]);

      if (res1.data.face_shape && res1.data.face_shape !== 'Unknown' && !faceShapeLocked.current) {
        setPhase1Result(res1.data);
        faceShapeLocked.current = true;
        console.log("FACE SHAPE LOCKED:", res1.data.face_shape);
      } else if (res1.data.error || res1.data.face_shape === 'Unknown') {
        setPhase1Result({ 
          error: res1.data.error || res1.data.guidance_message || 'Face shape could not be determined.',
          quality: res1.data.quality
        });
      }

      const validRes2 = res2Array.filter(r => r && r.data && r.data.quality?.status === 'valid');
      const primaryRes2 = res2Array[0]?.data || { quality: { status: 'invalid', reasons: ['API unavailable'] } };

      let finalIpd = primaryRes2.ipd;
      if (validRes2.length > 0) {
        const validIpds = validRes2.map(r => r.data.ipd).filter(i => i && i.status === 'valid' && i.ipd_mm != null);
        if (validIpds.length >= 4) {
          const values = validIpds.map(i => i.ipd_mm).sort((a, b) => a - b);
          const median = values[Math.floor(values.length / 2)];
          const deviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
          const mad = deviations[Math.floor(deviations.length / 2)];
          const threshold = Math.max(mad * 3.0, 1.0);
          const stableIpds = values.filter(v => Math.abs(v - median) <= threshold);
          
          if (stableIpds.length >= 4) {
            const finalMedian = stableIpds[Math.floor(stableIpds.length / 2)];
            const finalDeviations = stableIpds.map(v => Math.abs(v - finalMedian)).sort((a, b) => a - b);
            const finalMad = finalDeviations[Math.floor(finalDeviations.length / 2)];
            
            if (finalMad <= 2.5) {
              finalIpd = {
                status: 'valid',
                ipd_mm: finalMedian,
                mad: finalMad,
                frames_used: stableIpds.length,
                method: validIpds[0].method || 'iris-calibrated'
              };
              if (primaryRes2.ipd?.ipd_mm && finalMedian && primaryRes2.measurements) {
                const scale = finalMedian / primaryRes2.ipd.ipd_mm;
                for (const key in primaryRes2.measurements) {
                  primaryRes2.measurements[key] = primaryRes2.measurements[key] * scale;
                }
              }
            }
          }
        }
      }

      const compiledPhase2 = {
        ...primaryRes2,
        ipd: finalIpd
      };
      setPhase2Result(compiledPhase2);

      // mm_per_px scale calibration for side views
      let mmPerPx = compiledPhase2.calibrated_mm_per_px;
      if (!mmPerPx && compiledPhase2.ipd?.ipd_mm && compiledPhase2.ipd?.iris_dist_px) {
        mmPerPx = compiledPhase2.ipd.ipd_mm / compiledPhase2.ipd.iris_dist_px;
      }

      // 3. Side Views Analysis (Right & Left)
      let rightRes = null;
      let leftRes = null;

      if (rightBlob) {
        try {
          const fdR = new FormData();
          fdR.append('image', rightBlob, 'right_side.jpg');
          fdR.append('side', 'right');
          if (mmPerPx) fdR.append('calibrated_mm_per_px', mmPerPx);
          const resR = await axios.post(`${API_BASE}/api/analyze/side-view`, fdR);
          rightRes = resR.data;
          setRightSideResult(resR.data);
        } catch (err) {
          rightRes = { status: 'invalid', side: 'right', message: 'Right side view analysis error' };
          setRightSideResult(rightRes);
        }
      }

      if (leftBlob) {
        try {
          const fdL = new FormData();
          fdL.append('image', leftBlob, 'left_side.jpg');
          fdL.append('side', 'left');
          if (mmPerPx) fdL.append('calibrated_mm_per_px', mmPerPx);
          const resL = await axios.post(`${API_BASE}/api/analyze/side-view`, fdL);
          leftRes = resL.data;
          setLeftSideResult(resL.data);
        } catch (err) {
          leftRes = { status: 'invalid', side: 'left', message: 'Left side view analysis error' };
          setLeftSideResult(leftRes);
        }
      }

      // 3b. AI Three-View Head Circumference Estimation (Ramanujan Ellipse with Physical Scaling)
      let headCircRes = null;
      if (!straightFaceOnlyRef.current && primaryFront && leftBlob && rightBlob) {
        try {
          const fdHead = new FormData();
          fdHead.append('front_image', primaryFront, 'front.jpg');
          fdHead.append('left_image', leftBlob, 'left.jpg');
          fdHead.append('right_image', rightBlob, 'right.jpg');
          if (mmPerPx) fdHead.append('calibrated_mm_per_px', mmPerPx);
          const resHead = await axios.post(`${API_BASE}/api/analyze/three-view-head`, fdHead);
          headCircRes = resHead.data;
          setHeadCircumferenceResult(resHead.data);
        } catch (err) {
          console.warn("Three-view head circumference analysis error:", err);
          headCircRes = { status: 'failed', message: err?.response?.data?.detail || err.message };
          setHeadCircumferenceResult(headCircRes);
        }
      }

      // 4. Recommendations
      const hcVal = validateHeadCircumference(userHeadCircumference);
      let userHcMm = null;
      let hcSource = 'camera_unavailable';

      if (hcVal.isValid) {
        userHcMm = hcVal.valueCm * 10.0;
        hcSource = 'user_entered';
      } else if (headCircRes?.status === 'estimated' && headCircRes?.circumference_mm) {
        userHcMm = headCircRes.circumference_mm;
        hcSource = 'ai_three_view';
      }

      const leftEarMm = leftRes?.measurements?.eye_to_ear_distance_mm || null;
      const rightEarMm = rightRes?.measurements?.eye_to_ear_distance_mm || null;
      const estTempleMm = rightRes?.measurements?.estimated_temple_length_mm || 
                          leftRes?.measurements?.estimated_temple_length_mm || null;

      let sideStatus = 'none';
      if (leftRes?.status === 'valid' && rightRes?.status === 'valid') sideStatus = 'both_captured';
      else if (rightRes?.status === 'valid') sideStatus = 'right_captured';
      else if (leftRes?.status === 'valid') sideStatus = 'left_captured';

      const reqBody = {
        face_shape: res1.data.face_shape || 'Oval',
        face_shape_confidence: res1.data.confidence || 0.8,
        ipd_mm: finalIpd?.ipd_mm || 63.0,
        ipd_method: finalIpd?.method || 'iris-calibrated',
        skin_tone: compiledPhase2.skin_tone?.skin_tone || 'Medium',
        undertone: compiledPhase2.skin_tone?.undertone || 'Neutral',
        budget: maxBudget && !isNaN(parseFloat(maxBudget)) ? parseFloat(maxBudget) : null,
        preferred_color: preferredColor.trim() || null,
        eye_shape: compiledPhase2.eye_shape?.eye_shape || 'Undetermined',
        eye_shape_confidence: compiledPhase2.eye_shape?.eye_shape_confidence || null,
        head_circumference_mm: userHcMm,
        head_circumference_source: hcSource,
        face_width_mm: compiledPhase2.measurements?.cheekbone_width_mm || null,
        left_eye_to_ear_mm: leftEarMm,
        right_eye_to_ear_mm: rightEarMm,
        estimated_temple_length_mm: estTempleMm,
        side_view_status: sideStatus
      };

      const recRes = await axios.post(`${API_BASE}/api/recommendations`, reqBody);
      setRecommendations(recRes.data.recommendations);
      setShowResults(true);
      setSessionState(SMART_GUIDED_STATES.COMPLETE);
    } catch (err) {
      console.error('Analysis error:', err);
      setErrorMsg('An error occurred during multi-view analysis. Please try again.');
      setSessionState(SMART_GUIDED_STATES.ERROR);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startSingleSideCapture = async (side) => {
    singleCaptureSideRef.current = side;
    setErrorMsg('');
    setSideErrorMsg('');
    stabilityCountRef.current = 0;
    sideStabilityStartTimeRef.current = 0;
    setStabilityProgress(0);
    isCapturingFrameRef.current = false;

    stopCameraAndMesh();

    const targetState = side === 'right' 
      ? SMART_GUIDED_STATES.GUIDING_RIGHT 
      : SMART_GUIDED_STATES.GUIDING_LEFT;

    setSessionState(targetState);
    sessionStateRef.current = targetState;
    captureSubStateRef.current = CAPTURE_SUBSTATES.WAITING_FOR_POSE;

    setPoseStatus('Waiting for face');
    setLiveGuidance({
      main: side === 'right' ? 'Right View: Slowly turn your head to the right.' : 'Left View: Slowly turn your head to the left.',
      corrective: false
    });

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 } },
        audio: false
      });
      const videoTracks = mediaStream.getVideoTracks();
      if (!videoTracks || videoTracks.length === 0) throw new Error("No video track found.");
      videoTracks[0].enabled = true;
      setStream(mediaStream);
      activeStreamRef.current = mediaStream;

      const video = videoRef.current;
      if (!video) throw new Error("Video element reference unavailable.");
      video.srcObject = mediaStream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      await new Promise(resolve => {
        if (video.readyState >= 1 && video.videoWidth > 0) resolve();
        else {
          const onMeta = () => { video.removeEventListener('loadedmetadata', onMeta); resolve(); };
          video.addEventListener('loadedmetadata', onMeta);
          setTimeout(resolve, 1500);
        }
      });
      try { await video.play(); } catch(e){}

      let fm = faceMeshRef.current;
      if (!fm) {
        fm = initFaceMesh();
        faceMeshRef.current = fm;
      }
      if (fm) {
        fm.onResults(handleFaceMeshResults);
        activeLoopRef.current = true;
        const processLoop = async () => {
          if (!activeLoopRef.current) return;
          if (videoRef.current && videoRef.current.readyState >= 2 && videoRef.current.videoWidth > 0 && faceMeshRef.current) {
            try { await faceMeshRef.current.send({ image: videoRef.current }); } catch (err) {}
          }
          if (activeLoopRef.current) {
            animFrameIdRef.current = requestAnimationFrame(processLoop);
          }
        };
        animFrameIdRef.current = requestAnimationFrame(processLoop);
      }

      speakVoice(side === 'right' ? "Slowly turn your face to the right." : "Slowly turn your face to the left.", null, true);
    } catch (err) {
      console.error("Camera startup error:", err);
      setErrorMsg("Failed to access camera: " + err.message);
      setSessionState(SMART_GUIDED_STATES.ERROR);
    }
  };

  const runSingleSideAnalysis = async (side, blob) => {
    setIsAnalyzing(true);
    setSessionState(SMART_GUIDED_STATES.PROCESSING);
    sessionStateRef.current = SMART_GUIDED_STATES.PROCESSING;
    try {
      let mmPerPx = phase2Result?.calibrated_mm_per_px;
      if (!mmPerPx && phase2Result?.ipd?.ipd_mm && phase2Result?.ipd?.iris_dist_px) {
        mmPerPx = phase2Result.ipd.ipd_mm / phase2Result.ipd.iris_dist_px;
      }
      const fd = new FormData();
      fd.append('image', blob, `${side}_side.jpg`);
      fd.append('side', side);
      if (mmPerPx) fd.append('calibrated_mm_per_px', mmPerPx);

      const res = await axios.post(`${API_BASE}/api/analyze/side-view`, fd);
      let updatedRight = side === 'right' ? res.data : rightSideResult;
      let updatedLeft = side === 'left' ? res.data : leftSideResult;

      if (side === 'right') {
        setRightSideResult(res.data);
      } else {
        setLeftSideResult(res.data);
      }

      // Re-evaluate three-view head circumference if both sides + front exist
      let currentHeadCirc = headCircumferenceResult;
      const frontBlob = capturedBlobsRef.current?.frontBlobs?.[0];
      const otherSideBlob = side === 'right' ? capturedBlobsRef.current?.leftBlob : capturedBlobsRef.current?.rightBlob;
      const curLeft = side === 'left' ? blob : otherSideBlob;
      const curRight = side === 'right' ? blob : otherSideBlob;

      if (frontBlob && curLeft && curRight) {
        try {
          const fdHead = new FormData();
          fdHead.append('front_image', frontBlob, 'front.jpg');
          fdHead.append('left_image', curLeft, 'left.jpg');
          fdHead.append('right_image', curRight, 'right.jpg');
          if (mmPerPx) fdHead.append('calibrated_mm_per_px', mmPerPx);
          const resHead = await axios.post(`${API_BASE}/api/analyze/three-view-head`, fdHead);
          currentHeadCirc = resHead.data;
          setHeadCircumferenceResult(resHead.data);
        } catch (hErr) {
          console.warn("Single side update: head circumference analysis error:", hErr);
        }
      }

      // Refresh recommendations
      const hcVal = validateHeadCircumference(userHeadCircumference);
      let userHcMm = null;
      let hcSource = 'camera_unavailable';

      if (hcVal.isValid) {
        userHcMm = hcVal.valueCm * 10.0;
        hcSource = 'user_entered';
      } else if (currentHeadCirc?.status === 'estimated' && currentHeadCirc?.circumference_mm) {
        userHcMm = currentHeadCirc.circumference_mm;
        hcSource = 'ai_three_view';
      }

      const leftEarMm = updatedLeft?.measurements?.eye_to_ear_distance_mm || null;
      const rightEarMm = updatedRight?.measurements?.eye_to_ear_distance_mm || null;
      const estTempleMm = updatedRight?.measurements?.estimated_temple_length_mm || 
                          updatedLeft?.measurements?.estimated_temple_length_mm || null;
      let sideStatus = 'none';
      if (updatedLeft?.status === 'valid' && updatedRight?.status === 'valid') sideStatus = 'both_captured';
      else if (updatedRight?.status === 'valid') sideStatus = 'right_captured';
      else if (updatedLeft?.status === 'valid') sideStatus = 'left_captured';

      const reqBody = {
        face_shape: phase1Result?.face_shape || 'Oval',
        face_shape_confidence: phase1Result?.confidence || 0.8,
        ipd_mm: phase2Result?.ipd?.ipd_mm || 63.0,
        ipd_method: phase2Result?.ipd?.method || 'iris-calibrated',
        skin_tone: phase2Result?.skin_tone?.skin_tone || 'Medium',
        undertone: phase2Result?.skin_tone?.undertone || 'Neutral',
        budget: maxBudget && !isNaN(parseFloat(maxBudget)) ? parseFloat(maxBudget) : null,
        preferred_color: preferredColor.trim() || null,
        eye_shape: phase2Result?.eye_shape?.eye_shape || 'Undetermined',
        eye_shape_confidence: phase2Result?.eye_shape?.eye_shape_confidence || null,
        head_circumference_mm: userHcMm,
        head_circumference_source: hcSource,
        face_width_mm: phase2Result?.measurements?.cheekbone_width_mm || null,
        left_eye_to_ear_mm: leftEarMm,
        right_eye_to_ear_mm: rightEarMm,
        estimated_temple_length_mm: estTempleMm,
        side_view_status: sideStatus
      };

      const recRes = await axios.post(`${API_BASE}/api/recommendations`, reqBody);
      setRecommendations(recRes.data.recommendations);
      setShowResults(true);
      setSessionState(SMART_GUIDED_STATES.COMPLETE);
      sessionStateRef.current = SMART_GUIDED_STATES.COMPLETE;
    } catch (err) {
      console.error("Single side analysis error:", err);
      setSideErrorMsg(`${side.toUpperCase()} view analysis error: ${err.message}`);
      setSessionState(SMART_GUIDED_STATES.COMPLETE);
    } finally {
      setIsAnalyzing(false);
      singleCaptureSideRef.current = null;
    }
  };

  const getQualityMessage = (reason) => {
    const reasons = {
      'no_face': 'Face not detected. Please position your face in the frame.',
      'not_facing_camera': 'Please face the camera directly.',
      'head_not_level': 'Keep your head level and try again.',
      'excessive_head_pose': 'Please face the camera directly.',
      'face_not_centered': 'Keep your face centered.',
      'face_too_small': 'Keep the face sufficiently close and clearly visible.',
      'multiple_faces': 'Multiple faces detected. Please ensure only one person is in the frame.',
      'too_dark': 'Lighting is too dark. Please move to a brighter area.',
      'too_bright': 'Lighting is too harsh. Please reduce glare.',
      'blur': 'Hold steady and avoid rapid motion.',
      'invalid_image': 'Image could not be processed. Please try again.',
      'waiting': 'Face not detected. Please position your face in the frame.'
    };
    return reasons[reason] || reason;
  };

  const isSessionActive = [
    SMART_GUIDED_STATES.WAITING_FOR_FACE,
    SMART_GUIDED_STATES.CHECKING_FRONT_POSE,
    SMART_GUIDED_STATES.GUIDING_FRONT,
    SMART_GUIDED_STATES.VERIFYING_FRONT_STABILITY,
    SMART_GUIDED_STATES.CAPTURING_FRONT,
    SMART_GUIDED_STATES.GUIDING_RIGHT,
    SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE,
    SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY,
    SMART_GUIDED_STATES.CAPTURING_RIGHT,
    SMART_GUIDED_STATES.GUIDING_LEFT,
    SMART_GUIDED_STATES.VERIFYING_LEFT_POSE,
    SMART_GUIDED_STATES.VERIFYING_LEFT_STABILITY,
    SMART_GUIDED_STATES.CAPTURING_LEFT
  ].includes(sessionState);

  const getStepProgressState = (stepIndex) => {
    // 1: Front, 2: Right, 3: Left, 4: Complete
    if (stepIndex === 1) {
      if ([
        SMART_GUIDED_STATES.GUIDING_RIGHT,
        SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE,
        SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY,
        SMART_GUIDED_STATES.CAPTURING_RIGHT,
        SMART_GUIDED_STATES.GUIDING_LEFT,
        SMART_GUIDED_STATES.VERIFYING_LEFT_POSE,
        SMART_GUIDED_STATES.VERIFYING_LEFT_STABILITY,
        SMART_GUIDED_STATES.CAPTURING_LEFT,
        SMART_GUIDED_STATES.PROCESSING,
        SMART_GUIDED_STATES.COMPLETE
      ].includes(sessionState)) {
        return 'completed';
      }
      if ([
        SMART_GUIDED_STATES.WAITING_FOR_FACE,
        SMART_GUIDED_STATES.CHECKING_FRONT_POSE,
        SMART_GUIDED_STATES.GUIDING_FRONT,
        SMART_GUIDED_STATES.VERIFYING_FRONT_STABILITY,
        SMART_GUIDED_STATES.CAPTURING_FRONT
      ].includes(sessionState)) {
        return 'active';
      }
      return '';
    } else if (stepIndex === 2) {
      if ([
        SMART_GUIDED_STATES.GUIDING_RIGHT,
        SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE,
        SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY,
        SMART_GUIDED_STATES.CAPTURING_RIGHT,
        SMART_GUIDED_STATES.PROCESSING,
        SMART_GUIDED_STATES.COMPLETE
      ].includes(sessionState)) {
        return 'completed';
      }
      if ([
        SMART_GUIDED_STATES.GUIDING_LEFT,
        SMART_GUIDED_STATES.VERIFYING_LEFT_POSE,
        SMART_GUIDED_STATES.VERIFYING_LEFT_STABILITY,
        SMART_GUIDED_STATES.CAPTURING_LEFT
      ].includes(sessionState)) {
        return 'active';
      }
      return '';
    } else if (stepIndex === 3) {
      if ([
        SMART_GUIDED_STATES.PROCESSING,
        SMART_GUIDED_STATES.COMPLETE
      ].includes(sessionState)) {
        return 'completed';
      }
      if ([
        SMART_GUIDED_STATES.GUIDING_RIGHT,
        SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE,
        SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY,
        SMART_GUIDED_STATES.CAPTURING_RIGHT
      ].includes(sessionState)) {
        return 'active';
      }
      return '';
    } else if (stepIndex === 4) {
      if (sessionState === SMART_GUIDED_STATES.COMPLETE || (showResults && !isSessionActive)) {
        return 'completed';
      }
      if (sessionState === SMART_GUIDED_STATES.PROCESSING) {
        return 'active';
      }
      return '';
    }
    return '';
  };

  // EyeReach: Personalized Welcome Banner with dynamic greeting and logo badge
  const renderWelcomeBanner = () => {
    if (!welcomeNotice) return null;
    return (
      <div className="eyereach-welcome-banner-wrap" role="status" aria-live="polite">
        <div className="eyereach-welcome-banner-card">
          <div className="eyereach-welcome-badge">
            <EyeReachLogo size={28} />
          </div>
          <div className="eyereach-welcome-text-block">
            <div className="eyereach-welcome-greeting">
              {welcomeNotice.isReturning ? (
                <>Welcome Back, <span className="eyereach-welcome-name-highlight">{welcomeNotice.name}</span>!</>
              ) : (
                <>Welcome to EyeReach, <span className="eyereach-welcome-name-highlight">{welcomeNotice.name}</span>!</>
              )}
            </div>
            <div className="eyereach-welcome-sub">
              {welcomeNotice.isReturning 
                ? `Hello ${welcomeNotice.name}, Your EyeReach Journey Continues! Your home testing profile is securely restored.` 
                : `Hello ${welcomeNotice.name}, your personalized home testing profile has been saved.`}
            </div>
          </div>
          <button 
            type="button"
            className="eyereach-welcome-dismiss-btn"
            onClick={() => setWelcomeNotice(null)}
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  };

  if (isCheckingSession) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 30%, #0c2b29 0%, #061517 60%, #030a0c 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ffffff',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          animation: 'pulse 1.8s ease-in-out infinite'
        }}>
          <EyeReachLogo size={80} />
        </div>
        <div style={{ marginTop: '24px', fontSize: '1.4rem', fontWeight: 800, letterSpacing: '0.5px' }}>
          Eye<span style={{ color: '#2dd4bf' }}>Reach</span>
        </div>
        <div style={{ marginTop: '8px', fontSize: '0.85rem', color: '#94a3b8' }}>
          Restoring your authenticated session...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthPage 
        onLogin={(user, isReturning) => {
          setIsAuthenticated(true);
          const fullUser = user || { isGuest: true, name: 'Guest User', role: 'customer' };
          setCurrentUser(fullUser);
          if (fullUser?.role === 'shop_owner') {
            setActiveView('shop_dashboard');
          } else {
            setActiveView('catalog');
          }
          if (!fullUser.isGuest) {
            const actualName = fullUser.name || fullUser.owner_name || 'Valued User';
            setWelcomeNotice({
              name: actualName,
              isReturning: Boolean(isReturning ?? fullUser.is_returning)
            });
          }
        }} 
      />
    );
  }

  // MODULE 1 & 2: Optical Shop Owner Dashboard Flow
  if (currentUser?.role === 'shop_owner') {
    return (
      <>
        {renderWelcomeBanner()}
        <ShopDashboard
          shopUser={currentUser}
          onLogout={handleLogout}
          onSwitchToCustomer={() => {
            setCurrentUser((prev) => ({ ...prev, role: 'customer' }));
            setActiveView('catalog');
          }}
        />
      </>
    );
  }

  // EyeReach: Appointment Scheduling Page (Meeting & Home Testing)
  if (activeView === 'appointment') {
    return (
      <>
        {renderWelcomeBanner()}
        <AppointmentScheduler 
          onBack={() => setActiveView('catalog')}
          onOpenScan={() => setActiveView('dashboard')}
          onOpenBoutique={() => setActiveView('catalog')}
          preSelectedFrames={homeVisitSelectedFrames}
          defaultUser={currentUser}
          faceAnalysisData={{
            phase1Result,
            phase2Result,
            capturedImage,
            leftSideResult,
            rightSideResult,
            headCircumferenceResult
          }}
        />
      </>
    );
  }

  // MODULE 7: Customer Application (Boutique & Catalog Browsing)
  if (activeView === 'catalog') {
    return (
      <div>
        {renderWelcomeBanner()}
        {/* Navigation Bar */}
        <div style={{
          backgroundColor: '#0f172a',
          color: '#ffffff',
          padding: '0.75rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #1e293b',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>👓</span>
            <span style={{ fontWeight: 800, fontSize: '1.15rem', color: '#ffffff' }}>EyeReach – Home Testing App</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveView('catalog')}
              style={{
                background: '#0d7665',
                color: '#ffffff',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              🛍️ Optical Boutique
            </button>

            <button
              onClick={() => setActiveView('appointment')}
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)'
              }}
            >
              📅 Schedule an Appointment
            </button>

            <button
              onClick={() => setActiveView('dashboard')}
              style={{
                background: 'rgba(255,255,255,0.1)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.2)',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              📷 3-View Biometric Scan
            </button>

            <button
              onClick={() => {
                setCurrentUser((prev) => ({
                  ...prev,
                  role: 'shop_owner',
                  owner_name: prev?.name || 'Rajesh Sharma',
                  shop_name: 'VisionCraft Opticians'
                }));
                setActiveView('shop_dashboard');
              }}
              style={{
                background: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #38bdf8',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              🏪 Switch to Store Owner View
            </button>

            <div className="eyereach-nav-user-pill" title={currentUser?.name || currentUser?.email}>
              <span className="eyereach-user-dot" />
              <span className="eyereach-nav-user-name">
                {currentUser?.isGuest ? 'Guest Session' : (currentUser?.name ? `Hello, ${currentUser.name}` : `Hello, ${currentUser?.email}`)}
              </span>
            </div>

            <button
              onClick={handleLogout}
              style={{
                background: 'transparent',
                color: '#ef4444',
                border: 'none',
                padding: '0.5rem',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        <CustomerPortal
          customerUser={currentUser}
          onOpenAppointment={(frames) => {
            if (frames && Array.isArray(frames)) {
              setHomeVisitSelectedFrames(frames);
            }
            setActiveView('appointment');
          }}
          onOpenScan={() => setActiveView('dashboard')}
          onOpenTryOn={(prod) => {
            setTryOnFrame({
              id: prod.product_id || prod.id,
              name: prod.name,
              brand: prod.brand,
              category: (prod.shape || 'round').toLowerCase(),
              image: prod.front_image,
              price: prod.price,
              color: prod.color,
              width_mm: prod.frame_width_mm || 125,
              lens_width_mm: prod.lens_width_mm || 50,
              bridge_width_mm: prod.bridge_width_mm || 18,
              temple_length_mm: prod.temple_length_mm || 140
            });
            setShowTryOn(true);
          }}
          onSwitchToShop={() => {
            setCurrentUser((prev) => ({
              ...prev,
              role: 'shop_owner',
              owner_name: prev?.name || 'Rajesh Sharma',
              shop_name: 'VisionCraft Opticians'
            }));
            setActiveView('shop_dashboard');
          }}
          detectedFaceData={phase1Result ? {
            face_shape: phase1Result.face_shape,
            ipd_mm: phase2Result?.ipd?.ipd_mm,
            undertone: phase2Result?.skin_tone?.undertone
          } : (currentUser?.face_shape ? {
            face_shape: currentUser.face_shape,
            ipd_mm: currentUser.ipd_mm,
            undertone: null
          } : null)}
        />

        {showTryOn && tryOnFrame && (
          <VirtualTryOn 
            frame={tryOnFrame} 
            allRecommendations={recommendations || []} 
            apiBase={API_BASE}
            leftEyeToEarMm={leftSideResult?.measurements?.eye_to_ear_distance_mm}
            rightEyeToEarMm={rightSideResult?.measurements?.eye_to_ear_distance_mm}
            estimatedTempleLengthMm={rightSideResult?.measurements?.estimated_temple_length_mm || leftSideResult?.measurements?.estimated_temple_length_mm}
            userIpdMm={phase2Result?.ipd?.ipd_mm}
            faceWidthMm={phase2Result?.measurements?.cheekbone_width_mm}
            calibratedMmPerPx={phase2Result?.calibrated_mm_per_px}
            userFaceShape={phase1Result?.face_shape}
            headCircumferenceResult={headCircumferenceResult}
            initialMode={tryOnMode}
            onSaveFitResult={(report, frameObj) => {
              setSavedFitReports(prev => ({
                ...prev,
                [frameObj.id]: { report, frame: frameObj }
              }));
            }}
            onClose={() => setShowTryOn(false)} 
          />
        )}
      </div>
    );
  }

  if (activeView === 'dashboard') {
    return (
      <div className="dashboard-container" style={{minHeight: '100vh', background: '#f8fafc', color: '#0f172a', padding: '1.5rem', fontFamily: 'system-ui, -apple-system, sans-serif'}}>
        {renderWelcomeBanner()}
        <div className="scan-dashboard-wrapper">
          {/* Header */}
          <div className="scan-dashboard-header">
            <div>
              <h1 className="scan-dashboard-title">EyeReach – Home Testing App</h1>
              <div className="scan-dashboard-subtitle">Biometric Eyewear Fitting & Style Intelligence</div>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'}}>
              <button 
                onClick={() => setActiveView('catalog')}
                style={{
                  background: '#0d7665',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                🛍️ Optical Boutique
              </button>
              <button 
                onClick={() => setActiveView('appointment')}
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                📅 Schedule Appointment
              </button>
              <div className={`scan-user-pill ${currentUser?.isGuest ? 'guest' : ''}`}>
                <span>{currentUser?.isGuest ? '👤 Guest Session' : `👤 ${currentUser?.name || currentUser?.email}`}</span>
              </div>
              <button 
                className="scan-btn-signout"
                onClick={handleLogout}
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Guest Notice Banner */}
          {currentUser?.isGuest && (
            <div className="scan-guest-banner">
              <strong>Guest Access Mode:</strong> You are using EyeReach – Home Testing App as a guest. All camera scans and frame recommendations remain private and temporary to your current browser session. No permanent profile data is stored without an account.
            </div>
          )}

          {/* If there are existing scan results in this session, show a shortcut */}
          {showResults && phase2Result && (
            <div style={{
              background: '#ecfdf5',
              border: '2px solid #a7f3d0',
              borderRadius: '12px',
              padding: '1rem 1.5rem',
              marginBottom: '2rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <div>
                <strong style={{color: '#065f46', fontSize: '1.05rem'}}>✓ Active Face Scan Available:</strong>
                <span style={{color: '#047857', marginLeft: '0.5rem', fontSize: '0.95rem'}}>
                  {scanMode === 'straight' ? 'Straight Face Scan' : 'Complete Three-View Scan'} ({phase1Result?.face_shape || 'Face Detected'}, IPD: {phase2Result.ipd?.ipd_mm?.toFixed(1)} mm)
                </span>
              </div>
              <button 
                className="btn primary"
                onClick={() => setActiveView('scanner')}
                style={{minHeight: '44px', padding: '0.6rem 1.25rem', fontSize: '0.95rem'}}
              >
                View Scan Results & Recommendations →
              </button>
            </div>
          )}

          {/* Unified Three-View Workflow Card */}
          <div style={{ maxWidth: '820px', margin: '0 auto' }}>
            <div className="scan-option-card highlight" style={{ padding: '2rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span className="scan-option-badge recommended">⭐ Unified 3-View Biometric Scan</span>
                  <span style={{ fontSize: '0.8rem', color: '#0f766e', fontWeight: 600 }}>Normal RGB Camera • 2D Silhouette AI</span>
                </div>
                <h2 className="scan-option-title" style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>
                  Three-View Facial & Head Circumference Scan
                </h2>
                <p className="scan-option-desc" style={{ fontSize: '0.95rem', marginBottom: '1.5rem', color: '#475569' }}>
                  A seamless 3-angle guided scan combining Front, Left, and Right 2D camera views. Analyzes complete craniofacial geometry to calculate face shape, iris-calibrated IPD, 3D cranial head circumference, and physical frame fit.
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.75rem'
                }}>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '1.2rem' }}>📸</span>
                      <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>1. Front View</strong>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>
                      Detects face shape, measures iris-calibrated IPD (±1.5 mm), and extracts transverse cranial breadth.
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '1.2rem' }}>🔄</span>
                      <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>2. Left Profile</strong>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>
                      Measures eye-to-tragus temple reach and cranial depth from the left silhouette.
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '1.2rem' }}>🔄</span>
                      <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>3. Right Profile</strong>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>
                      Validates bilateral symmetry, right temple reach, and fuses cranial depth for ellipse modeling.
                    </div>
                  </div>
                </div>

                <div style={{
                  background: '#f0fdfa',
                  border: '1px solid #ccfbf1',
                  borderRadius: '10px',
                  padding: '0.85rem 1rem',
                  marginBottom: '1.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <span style={{ fontSize: '1.4rem' }}>🧠</span>
                  <div style={{ fontSize: '0.82rem', color: '#0f766e', lineHeight: 1.45 }}>
                    <strong>AI Head Circumference Estimation:</strong> Combines cranial breadth and fused antero-posterior depth using Ramanujan's ellipse approximation with inter-view scale propagation. No manual measuring tape required.
                  </div>
                </div>
              </div>

              <div>
                {capturedImage && capturedBlobsRef.current.frontBlobs.length > 0 ? (
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <button 
                      className="scan-action-btn primary"
                      style={{ flex: '1 1 240px' }}
                      onClick={startThreeViewReusingFront}
                    >
                      ⚡ Continue Three-View (Reuse Front Photo)
                    </button>
                    <button 
                      className="scan-action-btn outline"
                      style={{ flex: '1 1 200px' }}
                      onClick={() => startAutomaticAnalysis(false)}
                    >
                      Start Fresh Three-View Scan
                    </button>
                  </div>
                ) : (
                  <button 
                    className="scan-action-btn primary"
                    style={{ width: '100%', fontSize: '1.05rem', padding: '0.9rem 1.5rem' }}
                    onClick={() => startAutomaticAnalysis(false)}
                  >
                    Start Unified Three-View Scan
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {renderWelcomeBanner()}
      <div className="scanner-top-nav">
        <button 
          className="btn-back-dashboard"
          onClick={returnToDashboard}
        >
          ← Back to Face Scan Dashboard
        </button>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap'}}>
          <span style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: '20px',
            background: scanMode === 'straight' ? '#e0f2fe' : '#ccfbf1',
            color: scanMode === 'straight' ? '#0369a1' : '#0f766e'
          }}>
            {scanMode === 'straight' ? 'Frontal Face Scan' : 'Unified Three-View Scan'}
          </span>
          <span className={`scan-user-pill ${currentUser?.isGuest ? 'guest' : ''}`} style={{fontSize: '0.82rem', padding: '4px 8px'}}>
            {currentUser?.isGuest ? 'Guest' : (currentUser?.name || currentUser?.email)}
          </span>
          <button 
            className="scan-btn-signout"
            style={{minHeight: '36px', padding: '0.35rem 0.75rem', fontSize: '0.85rem'}}
            onClick={handleLogout}
          >
            Sign Out
          </button>
        </div>
      </div>

      <header>
        <div className="logo-section">
          <h1>EyeReach – Home Testing App</h1>
          <div className="subtitle">Automatic Three-View Video Capture & Biometric Recommendations</div>
        </div>
        <div className="status-badge">
          <div className="status-dot"></div>
          FastAPI Engine Ready
        </div>
      </header>

      <main className="layout-grid">
        
        <div className="top-panels">
          {/* LEFT PANEL */}
          <div className="left-panel">
            <div className="panel" style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
              
              {/* Simple Smart Progress Stepper */}
              {scanMode === 'straight' ? (
                <div className="smart-progress-stepper">
                  <div className={`smart-step ${getStepProgressState(1)}`}>
                    <span className="step-badge-num">{getStepProgressState(1) === 'completed' ? '✓' : '1'}</span>
                    <span className="step-name">Front View</span>
                  </div>
                  <div className="step-divider">→</div>
                  <div className={`smart-step ${showResults ? 'completed' : isAnalyzing ? 'active' : ''}`}>
                    <span className="step-badge-num">{showResults ? '✓' : '2'}</span>
                    <span className="step-name">Recommendations</span>
                  </div>
                </div>
              ) : (
                <div className="smart-progress-stepper">
                  <div className={`smart-step ${getStepProgressState(1)}`}>
                    <span className="step-badge-num">{getStepProgressState(1) === 'completed' ? '✓' : '1'}</span>
                    <span className="step-name">Front</span>
                  </div>
                  <div className="step-divider">→</div>
                  <div className={`smart-step ${getStepProgressState(2)}`}>
                    <span className="step-badge-num">{getStepProgressState(2) === 'completed' ? '✓' : '2'}</span>
                    <span className="step-name">Left</span>
                  </div>
                  <div className="step-divider">→</div>
                  <div className={`smart-step ${getStepProgressState(3)}`}>
                    <span className="step-badge-num">{getStepProgressState(3) === 'completed' ? '✓' : '3'}</span>
                    <span className="step-name">Right</span>
                  </div>
                  <div className="step-divider">→</div>
                  <div className={`smart-step ${getStepProgressState(4)}`}>
                    <span className="step-badge-num">{getStepProgressState(4) === 'completed' ? '✓' : '4'}</span>
                    <span className="step-name">Complete</span>
                  </div>
                </div>
              )}

              {/* Capture Guidance Interface Card */}
              {scanMode === 'straight' ? (
                <div className="capture-guidance-card">
                  <div className="capture-guidance-title">
                    <span>📸 Straight Face Scan Instructions</span>
                  </div>
                  <div className="capture-guidance-grid">
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">1️⃣</span>
                      <span>Look directly at the camera with a relaxed expression</span>
                    </div>
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">🎯</span>
                      <span>Keep face centered at eye level</span>
                    </div>
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">⏱️</span>
                      <span>Hold steady for 1.5 seconds to capture</span>
                    </div>
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">✨</span>
                      <span>Instant face shape & IPD recommendations</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="capture-guidance-card">
                  <div className="capture-guidance-title">
                    <span>📸 Three-View Capture Instructions</span>
                  </div>
                  <div className="capture-guidance-grid">
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">1️⃣</span>
                      <span>Front View: Look directly at the camera</span>
                    </div>
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">2️⃣</span>
                      <span>Left View: Slowly turn your head to the left (~60°–85°)</span>
                    </div>
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">3️⃣</span>
                      <span>Right View: Slowly turn your head to the right (~60°–85°)</span>
                    </div>
                    <div className="guidance-rule-item">
                      <span className="guidance-rule-icon">🎯</span>
                      <span>Keep face centered at eye level</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Dynamic Guidance Banner */}
              {isSessionActive && (
                <div className="auto-step-banner">
                  <div className="auto-step-header">
                    <span className="auto-step-title">
                      {scanMode === 'straight' 
                        ? 'Straight Face Scan (1/1)' 
                        : (
                            [SMART_GUIDED_STATES.WAITING_FOR_FACE, SMART_GUIDED_STATES.CHECKING_FRONT_POSE, SMART_GUIDED_STATES.GUIDING_FRONT, SMART_GUIDED_STATES.VERIFYING_FRONT_STABILITY, SMART_GUIDED_STATES.CAPTURING_FRONT].includes(sessionState) ? 'Front View (Step 1/3)' :
                            [SMART_GUIDED_STATES.GUIDING_LEFT, SMART_GUIDED_STATES.VERIFYING_LEFT_POSE, SMART_GUIDED_STATES.VERIFYING_LEFT_STABILITY, SMART_GUIDED_STATES.CAPTURING_LEFT].includes(sessionState) ? 'Left View (Step 2/3)' :
                            [SMART_GUIDED_STATES.GUIDING_RIGHT, SMART_GUIDED_STATES.VERIFYING_RIGHT_POSE, SMART_GUIDED_STATES.VERIFYING_RIGHT_STABILITY, SMART_GUIDED_STATES.CAPTURING_RIGHT].includes(sessionState) ? 'Right View (Step 3/3)' : 'Face Scan'
                          )}
                    </span>
                    <span className="auto-step-badge">
                      {poseStatus}
                    </span>
                  </div>
                  <div className="auto-instruction-main">
                    {liveGuidance.main}
                  </div>

                  {/* Stability Progress Bar */}
                  <div className="stability-container">
                    <div className="stability-label-row">
                      <span>Stability</span>
                      <span>{stabilityProgress}%</span>
                    </div>
                    <div className="stability-track">
                      <div className="stability-fill" style={{width: `${stabilityProgress}%`}}></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Viewport: Live Camera, Processing, or Result Preview */}
              <div className="camera-container" style={{position: 'relative', flex: 1, minHeight: '320px'}}>
                {/* Diagnostic Debug HUD Overlay */}
                {debugHudVisible && isSessionActive && (
                  <div className="debug-hud-overlay">
                    <div className="debug-hud-header">
                      <span className="debug-hud-title">🔍 DIAGNOSTIC HUD</span>
                      <button 
                        className="debug-hud-toggle-btn"
                        onClick={() => setDebugHudMinimized(!debugHudMinimized)}
                      >
                        {debugHudMinimized ? 'Expand' : 'Collapse'}
                      </button>
                    </div>
                    {!debugHudMinimized && (
                      <div className="debug-hud-body">
                        <div className="debug-hud-row">
                          <span className="debug-hud-label">Step:</span>
                          <span className="debug-hud-val bold">{debugHudData.currentStep}</span>
                        </div>
                        <div className="debug-hud-row">
                          <span className="debug-hud-label">Detected Pose:</span>
                          <span className={`debug-hud-badge ${debugHudData.detectedPose.toLowerCase()}`}>
                            {debugHudData.detectedPose}
                          </span>
                        </div>
                        <div className="debug-hud-row">
                          <span className="debug-hud-label">Estimated Yaw:</span>
                          <span className="debug-hud-val">
                            {debugHudData.estimatedYaw > 0 ? `+${debugHudData.estimatedYaw}°` : `${debugHudData.estimatedYaw}°`} 
                            <span style={{opacity: 0.65, fontSize: '0.65rem', marginLeft: '4px'}}>
                              (r: {debugHudData.eyeRatio})
                            </span>
                          </span>
                        </div>
                        <div className="debug-hud-row">
                          <span className="debug-hud-label">Pose Reached:</span>
                          <span className={`debug-hud-pill ${debugHudData.requiredPoseReached ? 'pass' : 'fail'}`}>
                            {debugHudData.requiredPoseReached ? 'YES ✓' : 'NO ✗'}
                          </span>
                        </div>
                        <div className="debug-hud-row">
                          <span className="debug-hud-label">Landmarks:</span>
                          <span className={`debug-hud-pill ${debugHudData.landmarkQuality === 'PASS' ? 'pass' : 'fail'}`}>
                            {debugHudData.landmarkQuality}
                          </span>
                        </div>
                        {debugHudData.landmarkDetails && (
                          <div className="debug-hud-detail">
                            {debugHudData.landmarkDetails}
                          </div>
                        )}
                        <div className="debug-hud-row">
                          <span className="debug-hud-label">Status:</span>
                          <span className="debug-hud-val">{debugHudData.captureStatus}</span>
                        </div>
                        <div className="debug-hud-row">
                          <span className="debug-hud-label">Rejection:</span>
                          <span className={`debug-hud-reason ${debugHudData.rejectionReason === 'None' ? 'ok' : 'rejected'}`}>
                            {debugHudData.rejectionReason}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* The video element is ALWAYS mounted so videoRef.current is permanently valid */}
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className={`video-element ${flashActive ? 'flash-effect' : ''}`} 
                  style={{ display: (isSessionActive && stream) ? 'block' : 'none' }}
                />
                
                {isSessionActive && stream && (
                  <div className="alignment-guide">
                    <div className="eye-level-line">
                      <span className="eye-level-label">Eye Level</span>
                    </div>
                  </div>
                )}

                {sessionState === AUTO_STATES.CAMERA_INIT && (
                  <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', background: '#0f172a', zIndex: 5}}>
                    <RefreshCw className="spin" size={32} color="var(--primary)" style={{marginBottom: '0.75rem'}} />
                    <div style={{fontWeight: 600}}>Starting Camera Preview...</div>
                    <div style={{fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem'}}>Please grant camera permission if requested</div>
                  </div>
                )}

                {sessionState === AUTO_STATES.PROCESSING && (
                  <div className="processing-overlay">
                    <div className="processing-spinner"></div>
                    <h3 style={{margin: '0 0 0.5rem 0', color: 'var(--text-main)'}}>Analyzing your three-view scan...</h3>
                    <p style={{margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)'}}>
                      Measuring iris-calibrated binocular IPD, face shape, eye-to-ear distance, and temple length compatibility
                    </p>
                  </div>
                )}

                {showResults && capturedImage && !isSessionActive && sessionState !== AUTO_STATES.PROCESSING && (
                  <img 
                    src={capturedImage} 
                    style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)'}} 
                    alt="Captured front view" 
                  />
                )}

                {!isSessionActive && sessionState !== AUTO_STATES.PROCESSING && (!showResults || !capturedImage) && (
                  <div style={{height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', textAlign: 'center', background: 'var(--card-bg)'}}>
                    <Camera size={44} color="var(--primary)" style={{marginBottom: '0.75rem', opacity: 0.85}} />
                    <h3 style={{margin: '0 0 0.4rem 0', fontSize: '1.1rem'}}>Smart Guided Face Scan</h3>
                    <p style={{margin: '0 0 1.25rem 0', fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '340px'}}>
                      Look straight at the camera or upload a front-facing image for instant facial analysis.
                    </p>
                    <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center'}}>
                      <button 
                        onClick={() => startAutomaticAnalysis(true)} 
                        className="btn primary" 
                        style={{padding: '0.75rem 1.5rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'}}
                      >
                        <Camera size={18} /> Straight Face Scan
                      </button>
                      <button 
                        onClick={() => startAutomaticAnalysis(false)} 
                        className="btn secondary" 
                        style={{padding: '0.75rem 1.25rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'}}
                      >
                        Three-View Scan
                      </button>
                    </div>
                  </div>
                )}

                {/* Error Banner overlay if camera fails */}
                {errorMsg && !isSessionActive && (
                  <div style={{
                    position: 'absolute',
                    top: '12px',
                    left: '12px',
                    right: '12px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: '#991b1b',
                    fontSize: '0.82rem',
                    zIndex: 6,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                  }}>
                    <AlertTriangle size={20} color="#dc2626" style={{flexShrink: 0}} />
                    <div style={{flex: 1}}>{errorMsg}</div>
                  </div>
                )}

                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>

              {/* Controls */}
              <div className="controls" style={{marginTop: '0.75rem'}}>
                {isSessionActive ? (
                  <div style={{display: 'flex', gap: '8px', width: '100%'}}>
                    <button onClick={cancelAnalysis} className="btn secondary" style={{flex: 1}}>
                      Cancel Scan
                    </button>
                    {capturedBlobsRef.current.frontBlobs.length > 0 && !straightFaceOnlyRef.current && (
                      <button onClick={finishStraightFaceAnalysis} className="btn primary" style={{flex: 1}}>
                        Analyze Straight Face Now
                      </button>
                    )}
                    <button 
                      onClick={() => setDebugHudVisible(!debugHudVisible)} 
                      className="hud-visibility-toggle"
                      style={{padding: '0.45rem 0.85rem'}}
                    >
                      HUD: {debugHudVisible ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ) : showResults ? (
                  <div style={{display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap'}}>
                    <button onClick={() => startAutomaticAnalysis(scanMode === 'straight')} className="btn primary" style={{flex: 1, minHeight: '44px'}}>
                      <RefreshCw size={16} style={{marginRight: '6px'}} /> {scanMode === 'straight' ? 'Retake Straight Face' : 'Retake Face Scan'}
                    </button>
                    {scanMode === 'straight' && (
                      <button onClick={startThreeViewReusingFront} className="btn secondary" style={{flex: 1, minHeight: '44px', background: '#0d9488', color: '#fff', borderColor: '#0f766e', fontWeight: 600}}>
                        ⚡ Upgrade to 3-View
                      </button>
                    )}
                    <button 
                      onClick={() => setDebugHudVisible(!debugHudVisible)} 
                      className="hud-visibility-toggle"
                      style={{padding: '0.45rem 0.85rem'}}
                    >
                      HUD: {debugHudVisible ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ) : (
                  <div style={{width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)'}}>
                    <span>Or upload frontal photo:</span>
                    <label className="btn secondary" style={{cursor: 'pointer', padding: '0.35rem 0.75rem', fontSize: '0.75rem'}}>
                      Upload Image
                      <input 
                        type="file" 
                        accept="image/*" 
                        style={{display: 'none'}} 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = URL.createObjectURL(file);
                            setCapturedImage(url);
                            capturedBlobsRef.current.frontBlobs = [file];
                            faceShapeLocked.current = false;
                            setSessionState(AUTO_STATES.PROCESSING);
                            runAutomaticAnalysis();
                          }
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>

              {errorMsg && <div className="warning-text" style={{marginTop: '0.75rem', textAlign: 'center'}}>{errorMsg}</div>}
              {sideErrorMsg && <div className="warning-text" style={{marginTop: '0.75rem', textAlign: 'center'}}>{sideErrorMsg}</div>}
            </div>
          </div>

          {/* RIGHT PANEL: PRIMARY DETECTION SUMMARY */}
          <div className="right-panel">
            {showResults && phase2Result && phase2Result.quality && phase2Result.quality.status === 'invalid' ? (
              <div className="panel quality-error">
                <AlertTriangle size={48} color="#f87171" style={{ margin: '0 auto 1rem' }} />
                <h3>IMAGE QUALITY ISSUE</h3>
                <p style={{marginBottom: '1rem'}}>Please adjust your position and try again.</p>
                <ul style={{textAlign: 'left', display: 'inline-block', color: 'var(--error)', marginBottom: '2rem'}}>
                  {phase2Result.quality.reasons.map((r, i) => <li key={i}>• {getQualityMessage(r)}</li>)}
                </ul>
                <br/>
                <button onClick={startAutomaticAnalysis} className="btn primary" style={{width: '240px', margin: '0 auto'}}>
                  Restart Face Scan
                </button>
              </div>
            ) : showResults ? (
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '0.5rem' }}>
                  <span className="section-title" style={{ margin: 0 }}>YOUR EYEREACH ANALYSIS</span>
                  <button
                    onClick={() => setActiveView('appointment')}
                    style={{
                      background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.35rem 0.8rem',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)'
                    }}
                  >
                    📅 Schedule Appointment with Scan Results →
                  </button>
                </div>
                <div className="detection-result-container">
                  
                  {/* Processed face image */}
                  <div className="processed-image-wrapper">
                    {phase2Result?.annotated_image ? (
                      <img src={phase2Result.annotated_image} alt="Processed Face" />
                    ) : (
                      <div style={{color: 'var(--text-muted)'}}>No image</div>
                    )}
                  </div>
                  
                  {/* Analysis Data */}
                  <div className="analysis-data-wrapper">
                    
                    {/* FACE SHAPE */}
                    <div className="data-group">
                      <h3>FACE SHAPE</h3>
                      {phase1Result && !phase1Result.error && phase1Result.face_shape !== 'Unknown' ? (
                        <>
                          <div className="primary-stat">
                            {phase1Result.face_shape} 
                            <span style={{fontSize: '0.6em', marginLeft: '8px', padding: '2px 6px', background: 'rgba(5, 150, 105, 0.1)', color: 'var(--success)', borderRadius: '4px'}}>
                              LOCKED
                            </span>
                          </div>
                          <div className="secondary-stat">Confidence: {(phase1Result.confidence * 100).toFixed(0)}%</div>
                          {phase1Result.top_predictions && phase1Result.top_predictions.length > 0 && (
                            <div style={{fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px'}}>
                              Probabilities: {phase1Result.top_predictions.slice(0, 3).map(p => `${p.shape} ${(p.probability*100).toFixed(0)}%`).join(' • ')}
                            </div>
                          )}
                          {phase1Result.frames_evaluated > 1 && (
                            <div style={{fontSize: '0.72rem', color: '#047857', marginTop: '2px', fontWeight: 500}}>
                              Consensus from {phase1Result.frames_evaluated} frames ({phase1Result.stability} stability)
                            </div>
                          )}
                          {phase1Result.is_boundary_case && phase1Result.secondary_shape && (
                            <div style={{fontSize: '0.72rem', color: '#b45309', marginTop: '2px'}}>
                              Secondary tendency: {phase1Result.secondary_shape}
                            </div>
                          )}
                          {phase1Result.explanation && (
                            <div style={{fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px', fontStyle: 'italic'}}>
                              {phase1Result.explanation}
                            </div>
                          )}
                          {phase1Result.confidence < 0.5 && <div className="warning-text">Low confidence — recommendations may be less reliable.</div>}
                        </>
                      ) : (
                        <div className="secondary-stat" style={{color: 'var(--error)'}}>{phase1Result?.error || 'Unavailable'}</div>
                      )}
                    </div>

                    {/* FACIAL MEASUREMENTS */}
                    <div className="data-group">
                      <h3>FACIAL MEASUREMENTS</h3>
                      {phase2Result?.measurements?.cheekbone_width_mm || phase1Result?.measurements || phase1Result?.features ? (
                        <>
                          {phase2Result?.measurements?.cheekbone_width_mm ? (
                            <div className="secondary-stat">Face Width: <strong>{phase2Result.measurements.cheekbone_width_mm} mm</strong></div>
                          ) : phase1Result?.measurements?.cheekbone_width_px ? (
                            <div className="secondary-stat">Face Width: <strong>{phase1Result.measurements.cheekbone_width_px} px</strong></div>
                          ) : null}
                          {phase2Result?.measurements?.face_length_mm ? (
                            <div className="secondary-stat">Face Length: <strong>{phase2Result.measurements.face_length_mm} mm</strong></div>
                          ) : phase1Result?.measurements?.face_length_px ? (
                            <div className="secondary-stat">Face Length: <strong>{phase1Result.measurements.face_length_px} px</strong></div>
                          ) : null}
                          {phase2Result?.measurements?.jaw_width_mm ? (
                            <div className="secondary-stat">Jaw Width: <strong>{phase2Result.measurements.jaw_width_mm} mm</strong></div>
                          ) : phase1Result?.measurements?.jaw_width_px ? (
                            <div className="secondary-stat">Jaw Width: <strong>{phase1Result.measurements.jaw_width_px} px</strong></div>
                          ) : null}
                          {phase1Result?.features?.face_length_to_cheekbone_width && (
                            <div className="secondary-stat">Length/Width Ratio: <strong>{phase1Result.features.face_length_to_cheekbone_width.toFixed(2)}</strong></div>
                          )}
                          {phase1Result?.features?.avg_jaw_angle && (
                            <div className="secondary-stat">Jaw Angle: <strong>{phase1Result.features.avg_jaw_angle.toFixed(1)}°</strong></div>
                          )}
                        </>
                      ) : (
                        <div className="secondary-stat">Unavailable</div>
                      )}
                    </div>
                    
                    {/* IPD */}
                    <div className="data-group">
                      <h3>IPD</h3>
                      {phase2Result?.ipd?.status === 'valid' ? (
                        <>
                          <div className="primary-stat">{phase2Result.ipd.ipd_mm?.toFixed(1)} mm</div>
                          <div className="secondary-stat">Iris-calibrated camera estimate</div>
                          <div className="secondary-stat">{phase2Result.ipd.frames_used} valid frames</div>
                          <div className="secondary-stat">MAD: {phase2Result.ipd.mad?.toFixed(1)} mm</div>
                          <div className="secondary-stat">Stability: Good</div>
                        </>
                      ) : (
                        <>
                          <div className="primary-stat" style={{color: 'var(--error)'}}>Unavailable</div>
                          <div className="warning-text">{phase2Result?.ipd?.message || 'Measurement failed.'}</div>
                        </>
                      )}
                    </div>

                    {/* SKIN TONE */}
                    <div className="data-group">
                      <h3>SKIN TONE</h3>
                      {phase2Result?.skin_tone?.status === 'valid' ? (
                        <>
                          <div className="primary-stat">{phase2Result.skin_tone.skin_tone}</div>
                          <div className="secondary-stat">{phase2Result.skin_tone.undertone} undertone</div>
                        </>
                      ) : (
                        <div className="secondary-stat">Unavailable</div>
                      )}
                    </div>

                  </div>
                </div>
              </div>
            ) : (
              <div className="panel" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)'}}>
                <div style={{fontSize: '1rem', fontWeight: 500, marginBottom: '0.4rem'}}>Ready for Three-View Analysis</div>
                <div style={{fontSize: '0.85rem'}}>Click "Start Face Scan" to begin camera scanning</div>
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM SECTION: RECOMMENDATIONS & THREE-VIEW DETAILS */}
        {showResults && phase2Result && (!phase2Result.quality || phase2Result.quality.status === 'valid') && phase2Result.ipd?.status === 'valid' && (
          <>
            {/* THREE-VIEW FACIAL ANALYSIS */}
            <div className="panel">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem'}}>
                <div>
                  <span className="section-title" style={{margin: 0}}>
                    {scanMode === 'straight' ? 'STRAIGHT FACE ANALYSIS' : 'THREE-VIEW FACIAL ANALYSIS'}
                  </span>
                  <div style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem'}}>
                    {scanMode === 'straight' 
                      ? 'Single frontal biometrics for face shape classification, binocular IPD, and style recommendations'
                      : 'Multi-angle biometrics for eye-to-ear distance, temple length compatibility, and anatomical fit'}
                  </div>
                </div>
                <div style={{display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
                  {scanMode === 'straight' && (
                    <button 
                      onClick={startThreeViewReusingFront}
                      className="btn primary"
                      style={{fontSize: '0.82rem', padding: '0.4rem 0.85rem', background: '#0d9488'}}
                    >
                      ⚡ Upgrade to Complete 3-View (Reuse Front)
                    </button>
                  )}
                  <button 
                    onClick={() => startAutomaticAnalysis(scanMode === 'straight')}
                    className="btn secondary"
                    style={{fontSize: '0.8rem', padding: '0.35rem 0.75rem'}}
                  >
                    <RefreshCw size={14} style={{marginRight: '6px'}} /> Restart Scan
                  </button>
                  <button 
                    onClick={() => setActiveView('appointment')}
                    className="btn primary"
                    style={{fontSize: '0.8rem', padding: '0.35rem 0.75rem', background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)', color: '#ffffff'}}
                  >
                    📅 Book Appointment with Scan Results →
                  </button>
                </div>
              </div>

              {/* Exact Order: 1. Front View -> 2. Right Side Profile -> 3. Left Side Profile */}
              <div className="three-view-grid">
                
                {/* 1. FRONT VIEW */}
                <div className="view-card">
                  <div className="view-card-header">
                    <span className="view-card-title">1. Front View</span>
                    <span className="view-status-tag valid">Captured ✓</span>
                  </div>
                  <div className="view-card-img">
                    {phase2Result?.annotated_image ? (
                      <img src={phase2Result.annotated_image} alt="Front View" />
                    ) : (
                      <span style={{color: 'var(--text-muted)', fontSize: '0.8rem'}}>Front captured</span>
                    )}
                  </div>
                  <div className="view-metrics">
                    <div className="view-metric-row">
                      <span>Face Shape:</span>
                      <strong>{phase1Result?.face_shape || 'Detected'} (Locked)</strong>
                    </div>
                    {phase1Result?.confidence && (
                      <div className="view-metric-row">
                        <span>Confidence:</span>
                        <strong>{(phase1Result.confidence * 100).toFixed(0)}%</strong>
                      </div>
                    )}
                    <div className="view-metric-row">
                      <span>Binocular IPD:</span>
                      <strong>{phase2Result.ipd?.ipd_mm?.toFixed(1)} mm</strong>
                    </div>
                    {phase2Result?.measurements?.cheekbone_width_mm && (
                      <div className="view-metric-row">
                        <span>Cheekbone Width:</span>
                        <strong>{phase2Result.measurements.cheekbone_width_mm} mm</strong>
                      </div>
                    )}
                    {phase2Result?.measurements?.jaw_width_mm && (
                      <div className="view-metric-row">
                        <span>Jaw Width:</span>
                        <strong>{phase2Result.measurements.jaw_width_mm} mm</strong>
                      </div>
                    )}
                    {phase2Result?.measurements?.face_length_mm && (
                      <div className="view-metric-row">
                        <span>Face Height:</span>
                        <strong>{phase2Result.measurements.face_length_mm} mm</strong>
                      </div>
                    )}
                    {headCircumferenceResult?.head_breadth_cm && (
                      <div className="view-metric-row">
                        <span>Cranial Breadth:</span>
                        <strong style={{color: 'var(--primary)'}}>{headCircumferenceResult.head_breadth_cm} cm</strong>
                      </div>
                    )}
                    <div className="view-metric-row">
                      <span>IPD Calibration:</span>
                      <strong style={{fontSize: '0.74rem', color: 'var(--primary)'}}>
                        {phase2Result.ipd?.method === 'reference-calibrated' 
                          ? 'Reference Card Calibrated (±0.5 mm)' 
                          : 'Iris Calibrated (11.7 mm HVID, ±1.5 mm)'}
                      </strong>
                    </div>
                    <div className="view-metric-row">
                      <span>Head Orientation:</span>
                      <strong>Frontal (0° Yaw)</strong>
                    </div>
                  </div>
                  <div style={{padding: '8px 12px 10px'}}>
                    <button 
                      className="btn-retake-profile"
                      onClick={() => startAutomaticAnalysis(scanMode === 'straight')}
                    >
                      ↻ Retake Front View
                    </button>
                  </div>
                </div>

                {/* 2. LEFT SIDE VIEW */}
                <div className="view-card">
                  <div className="view-card-header">
                    <span className="view-card-title">2. Left Side Profile</span>
                    <span className={`view-status-tag ${
                      scanMode === 'straight' ? 'missing' : leftSideResult?.status === 'valid' ? 'valid' : leftSideResult?.status === 'invalid' ? 'error' : 'missing'
                    }`}>
                      {scanMode === 'straight' ? 'Omitted' : leftSideResult?.status === 'valid' ? 'Captured ✓' : leftSideResult?.status === 'invalid' ? 'Attention Needed' : 'Not Captured'}
                    </span>
                  </div>
                  <div className="view-card-img">
                    {scanMode === 'straight' ? (
                      <div style={{color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '1.25rem 0.5rem'}}>
                        <strong style={{color: '#334155'}}>Omitted in Straight Scan</strong>
                        <p style={{fontSize: '0.78rem', marginTop: '6px', color: '#64748b', lineHeight: 1.4}}>
                          Left profile measures ear tragus distance for temple arm length.
                        </p>
                        <button 
                          onClick={startThreeViewReusingFront}
                          className="btn-retake-profile"
                          style={{marginTop: '10px', background: '#0d9488', color: '#ffffff', borderColor: '#0f766e'}}
                        >
                          ⚡ Add Side Views (Reuse Front)
                        </button>
                      </div>
                    ) : leftSideResult?.annotated_image ? (
                      <img src={leftSideResult.annotated_image} alt="Left Side Profile with full landmark annotations" />
                    ) : capturedLeftImage ? (
                      <img src={capturedLeftImage} alt="Left Side Profile" />
                    ) : (
                      <div style={{color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '0.5rem'}}>
                        No left profile captured.<br/>Turn face sideways (~60°–85°) to assess profile.
                      </div>
                    )}
                  </div>
                  <div className="view-metrics">
                    <div className="view-metric-row">
                      <span>Pose Yaw:</span>
                      <strong>
                        {scanMode === 'straight' ? 'Omitted' : leftSideResult?.head_pose?.yaw_deg != null 
                          ? `${Math.abs(leftSideResult.head_pose.yaw_deg)}° (Near Profile)` 
                          : 'Pending'}
                      </strong>
                    </div>
                    <div className="view-metric-row">
                      <span>Scale Calibration:</span>
                      <strong>
                        {scanMode === 'straight' ? '—' : leftSideResult?.measurements?.eye_to_ear_distance_mm ? (
                          <span style={{fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(5, 150, 105, 0.1)', color: 'var(--success)', fontWeight: 600}}>
                            Calibrated (Front Iris Scale)
                          </span>
                        ) : (
                          <span style={{fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(217, 119, 6, 0.1)', color: '#d97706', fontWeight: 600}}>
                            Uncalibrated estimate
                          </span>
                        )}
                      </strong>
                    </div>
                    <div className="view-metric-row">
                      <span>Eye-to-Ear (Tragus):</span>
                      <strong>
                        {scanMode === 'straight' ? '—' : leftSideResult?.measurements?.eye_to_ear_distance_mm 
                          ? `${leftSideResult.measurements.eye_to_ear_distance_mm} mm`
                          : leftSideResult?.measurements?.eye_to_ear_distance_px
                          ? `${Math.round(leftSideResult.measurements.eye_to_ear_distance_px)} px (Est.)`
                          : 'Not assessed'}
                      </strong>
                    </div>
                    {leftSideResult?.measurements?.hinge_to_apex_mm && (
                      <div className="view-metric-row">
                        <span>Hinge-to-Apex (Otobasion):</span>
                        <strong>{leftSideResult.measurements.hinge_to_apex_mm} mm</strong>
                      </div>
                    )}
                    <div className="view-metric-row">
                      <span>Est. Reach to Mastoid:</span>
                      <strong>
                        {scanMode === 'straight' ? '—' : leftSideResult?.measurements?.estimated_temple_length_mm 
                          ? `~${leftSideResult.measurements.estimated_temple_length_mm} mm`
                          : 'Not assessed'}
                      </strong>
                    </div>
                    {leftSideResult?.measurements?.profile_height_mm && (
                      <div className="view-metric-row">
                        <span>Profile Height:</span>
                        <strong>{leftSideResult.measurements.profile_height_mm} mm</strong>
                      </div>
                    )}
                    {leftSideResult?.measurements?.nose_bridge_mm && (
                      <div className="view-metric-row">
                        <span>Nose Bridge Profile:</span>
                        <strong>{leftSideResult.measurements.nose_bridge_mm} mm</strong>
                      </div>
                    )}
                    {headCircumferenceResult?.head_depth_cm && (
                      <div className="view-metric-row">
                        <span>Cranial Depth:</span>
                        <strong style={{color: 'var(--primary)'}}>{headCircumferenceResult.head_depth_cm} cm</strong>
                      </div>
                    )}
                  </div>
                  {scanMode !== 'straight' && (
                    <div style={{padding: '8px 12px 10px'}}>
                      <button 
                        className="btn-retake-profile"
                        onClick={() => startSingleSideCapture('left')}
                      >
                        ↻ Retake Left Profile
                      </button>
                    </div>
                  )}
                  {leftSideResult?.status === 'invalid' && (
                    <div style={{fontSize: '0.75rem', color: 'var(--error)', background: 'var(--error-bg)', padding: '6px 10px', borderRadius: '6px', margin: '6px 8px'}}>
                      {leftSideResult.message || 'Adjust angle and retry.'}
                    </div>
                  )}
                </div>

                {/* 3. RIGHT SIDE VIEW */}
                <div className="view-card">
                  <div className="view-card-header">
                    <span className="view-card-title">3. Right Side Profile</span>
                    <span className={`view-status-tag ${
                      scanMode === 'straight' ? 'missing' : rightSideResult?.status === 'valid' ? 'valid' : rightSideResult?.status === 'invalid' ? 'error' : 'missing'
                    }`}>
                      {scanMode === 'straight' ? 'Omitted' : rightSideResult?.status === 'valid' ? 'Captured ✓' : rightSideResult?.status === 'invalid' ? 'Attention Needed' : 'Not Captured'}
                    </span>
                  </div>
                  <div className="view-card-img">
                    {scanMode === 'straight' ? (
                      <div style={{color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '1.25rem 0.5rem'}}>
                        <strong style={{color: '#334155'}}>Omitted in Straight Scan</strong>
                        <p style={{fontSize: '0.78rem', marginTop: '6px', color: '#64748b', lineHeight: 1.4}}>
                          Right profile confirms bilateral symmetry and temple reach.
                        </p>
                        <button 
                          onClick={startThreeViewReusingFront}
                          className="btn-retake-profile"
                          style={{marginTop: '10px', background: '#0d9488', color: '#ffffff', borderColor: '#0f766e'}}
                        >
                          ⚡ Add Side Views (Reuse Front)
                        </button>
                      </div>
                    ) : rightSideResult?.annotated_image ? (
                      <img src={rightSideResult.annotated_image} alt="Right Side Profile with full landmark annotations" />
                    ) : capturedRightImage ? (
                      <img src={capturedRightImage} alt="Right Side Profile" />
                    ) : (
                      <div style={{color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '0.5rem'}}>
                        No right profile captured.<br/>Turn face sideways (~60°–85°) to assess profile.
                      </div>
                    )}
                  </div>
                  <div className="view-metrics">
                    <div className="view-metric-row">
                      <span>Pose Yaw:</span>
                      <strong>
                        {scanMode === 'straight' ? 'Omitted' : rightSideResult?.head_pose?.yaw_deg != null 
                          ? `${Math.abs(rightSideResult.head_pose.yaw_deg)}° (Near Profile)` 
                          : 'Pending'}
                      </strong>
                    </div>
                    <div className="view-metric-row">
                      <span>Scale Calibration:</span>
                      <strong>
                        {scanMode === 'straight' ? '—' : rightSideResult?.measurements?.eye_to_ear_distance_mm ? (
                          <span style={{fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(5, 150, 105, 0.1)', color: 'var(--success)', fontWeight: 600}}>
                            Calibrated (Front Iris Scale)
                          </span>
                        ) : (
                          <span style={{fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(217, 119, 6, 0.1)', color: '#d97706', fontWeight: 600}}>
                            Uncalibrated estimate
                          </span>
                        )}
                      </strong>
                    </div>
                    <div className="view-metric-row">
                      <span>Eye-to-Ear (Tragus):</span>
                      <strong>
                        {scanMode === 'straight' ? '—' : rightSideResult?.measurements?.eye_to_ear_distance_mm 
                          ? `${rightSideResult.measurements.eye_to_ear_distance_mm} mm`
                          : rightSideResult?.measurements?.eye_to_ear_distance_px
                          ? `${Math.round(rightSideResult.measurements.eye_to_ear_distance_px)} px (Est.)`
                          : 'Not assessed'}
                      </strong>
                    </div>
                    {rightSideResult?.measurements?.hinge_to_apex_mm && (
                      <div className="view-metric-row">
                        <span>Hinge-to-Apex (Otobasion):</span>
                        <strong>{rightSideResult.measurements.hinge_to_apex_mm} mm</strong>
                      </div>
                    )}
                    <div className="view-metric-row">
                      <span>Est. Reach to Mastoid:</span>
                      <strong>
                        {scanMode === 'straight' ? '—' : rightSideResult?.measurements?.estimated_temple_length_mm 
                          ? `~${rightSideResult.measurements.estimated_temple_length_mm} mm`
                          : 'Not assessed'}
                      </strong>
                    </div>
                    {rightSideResult?.measurements?.profile_height_mm && (
                      <div className="view-metric-row">
                        <span>Profile Height:</span>
                        <strong>{rightSideResult.measurements.profile_height_mm} mm</strong>
                      </div>
                    )}
                    {rightSideResult?.measurements?.nose_bridge_mm && (
                      <div className="view-metric-row">
                        <span>Nose Bridge Profile:</span>
                        <strong>{rightSideResult.measurements.nose_bridge_mm} mm</strong>
                      </div>
                    )}
                    {headCircumferenceResult?.circumference_cm && (
                      <div className="view-metric-row">
                        <span>Est. Circumference:</span>
                        <strong style={{color: 'var(--primary)'}}>{headCircumferenceResult.circumference_cm} cm</strong>
                      </div>
                    )}
                  </div>
                  {scanMode !== 'straight' && (
                    <div style={{padding: '8px 12px 10px'}}>
                      <button 
                        className="btn-retake-profile"
                        onClick={() => startSingleSideCapture('right')}
                      >
                        ↻ Retake Right Profile
                      </button>
                    </div>
                  )}
                  {rightSideResult?.status === 'invalid' && (
                    <div style={{fontSize: '0.75rem', color: 'var(--error)', background: 'var(--error-bg)', padding: '6px 10px', borderRadius: '6px', margin: '6px 8px'}}>
                      {rightSideResult.message || 'Adjust angle and retry.'}
                    </div>
                  )}
                </div>

              </div>

              {/* Side Profile Fit Guidance Note */}
              <div style={{marginTop: '1rem', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--text-muted)'}}>
                <div style={{fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.2rem'}}>
                  Eyewear Fit & Temple Length Guidance
                </div>
                <div>
                  {(rightSideResult?.measurements?.eye_to_ear_distance_mm || leftSideResult?.measurements?.eye_to_ear_distance_mm) ? (
                    <span>
                      Side profile analysis measures your projected eye-to-ear distance ({rightSideResult?.measurements?.eye_to_ear_distance_mm || leftSideResult?.measurements?.eye_to_ear_distance_mm} mm) and hinge-to-apex distance ({rightSideResult?.measurements?.hinge_to_apex_mm || leftSideResult?.measurements?.hinge_to_apex_mm || '—'} mm).
                      Estimated required reach along the temporal line to the retroauricular groove is ~<strong>{Math.round(rightSideResult?.measurements?.estimated_temple_length_mm || leftSideResult?.measurements?.estimated_temple_length_mm)} mm</strong>.
                      Catalog frames are compared against manufacturer dimensions when available; frames without catalog temple metadata are indicated as <em>Insufficient Product Data</em> rather than assuming a default length.
                    </span>
                  ) : (
                    <span>
                      Front view establishes binocular IPD calibration. Capturing side profile views provides estimated eye-to-ear distance to assess spectacle temple arm compatibility.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ADDITIONAL FACIAL PARAMETERS */}
            <div className="panel">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem'}}>
                <div>
                  <span className="section-title" style={{margin: 0}}>ADDITIONAL FACIAL PARAMETERS</span>
                  <div style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem'}}>
                    Biometric attributes for personalized frame styling and physical fit calculation
                  </div>
                </div>
                {(() => {
                  const hcVal = validateHeadCircumference(userHeadCircumference);
                  return (
                    <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px'}}>
                      <div style={{
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.5rem', 
                        background: 'var(--panel-bg)', 
                        padding: '0.4rem 0.8rem', 
                        borderRadius: '8px', 
                        border: hcVal.error ? '1px solid var(--error)' : '1px solid var(--border)'
                      }}>
                        <label htmlFor="hc-input" style={{fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)'}}>
                          Manual Tape Override (Optional):
                        </label>
                        <input 
                          id="hc-input"
                          type="number"
                          step="0.5"
                          min="45"
                          max="68"
                          placeholder="e.g. 56.5"
                          value={userHeadCircumference}
                          onChange={(e) => setUserHeadCircumference(e.target.value)}
                          style={{
                            width: '85px', 
                            padding: '4px 8px', 
                            borderRadius: '4px', 
                            border: hcVal.error ? '1px solid var(--error)' : '1px solid var(--border)', 
                            fontSize: '0.85rem', 
                            outline: 'none'
                          }}
                        />
                        {userHeadCircumference && (
                          <button 
                            onClick={() => setUserHeadCircumference('')}
                            style={{background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 4px'}}
                            title="Clear manual entry"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {hcVal.error && (
                        <div style={{fontSize: '0.75rem', color: 'var(--error)', paddingRight: '4px'}}>
                          {hcVal.error}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="additional-params-grid">
                
                {/* 1. Eye Shape */}
                <div className="param-card">
                  <div>
                    <div className="param-header">
                      <span className="param-title">Eye Shape</span>
                      <span className={`param-badge ${phase2Result.eye_shape?.eye_shape === 'Undetermined' ? 'camera-na' : 'user-entered'}`}>
                        {phase2Result.eye_shape?.eye_shape === 'Undetermined' ? 'Geometric' : 'Personalization'}
                      </span>
                    </div>
                    <div className="param-val">
                      {phase2Result.eye_shape?.eye_shape || "Undetermined"}
                    </div>
                    <div className="param-sub">
                      {phase2Result.eye_shape?.measurements?.aspect_ratio != null 
                        ? `Aspect Ratio: ${phase2Result.eye_shape.measurements.aspect_ratio} • Tilt: ${phase2Result.eye_shape.measurements.canthal_tilt_deg}°`
                        : "Aspect analysis"}
                    </div>
                  </div>
                  <div className="param-explanation">
                    {phase2Result.eye_shape?.explanation || "Evaluates palpebral fissure aspect ratio and canthal tilt. Hooded and monolid types require 3D fold classification not discernible from 2D landmarks."}
                  </div>
                </div>

                {/* 2. Locked IPD */}
                <div className="param-card">
                  <div>
                    <div className="param-header">
                      <span className="param-title">Locked IPD</span>
                      <span className="param-badge compatible">
                        Calibrated ✓
                      </span>
                    </div>
                    <div className="param-val">
                      {phase2Result.ipd.ipd_mm.toFixed(1)} mm
                    </div>
                    <div className="param-sub">
                      Iris-calibrated camera estimate
                    </div>
                  </div>
                  <div className="param-explanation">
                    Preserved optical baseline. Used directly to calculate frame width decentration and physical lens alignment.
                  </div>
                </div>

                {/* 3. Head Circumference */}
                {(() => {
                  const hcVal = validateHeadCircumference(userHeadCircumference);
                  const isUserEntered = hcVal.isValid;
                  const isAiEstimated = !isUserEntered && headCircumferenceResult?.status === 'estimated';
                  const isUnreliable = !isUserEntered && headCircumferenceResult?.status === 'unreliable';

                  let badgeText = 'AI Three-View';
                  let badgeClass = 'user-entered';
                  let valText = 'Evaluating...';
                  let subText = '3D cranial circumference';
                  let explanationText = '';

                  if (isUserEntered) {
                    badgeText = 'Manually Entered';
                    badgeClass = 'user-entered';
                    valText = `${hcVal.valueCm.toFixed(1)} cm`;
                    subText = 'Manual tape measurement';
                    explanationText = `Manually entered cranial measurement (${hcVal.valueCm.toFixed(1)} cm). Factored into frame sizing and fit compatibility.`;
                  } else if (hcVal.error && userHeadCircumference) {
                    badgeText = 'Invalid Entry';
                    badgeClass = 'insufficient';
                    valText = 'Invalid Value';
                    subText = hcVal.error;
                    explanationText = `Invalid measurement: ${hcVal.error}. Please enter an adult head circumference between 45.0 cm and 68.0 cm.`;
                  } else if (isAiEstimated) {
                    badgeText = headCircumferenceResult.calibration_source === 'reference_object' 
                      ? 'Calibrated (Card)' 
                      : 'AI Three-View (Iris)';
                    badgeClass = 'compatible';
                    valText = `${headCircumferenceResult.circumference_cm} cm`;
                    subText = `Ramanujan Ellipse (${headCircumferenceResult.reliability_tier || 'Biometric Estimate'})`;
                    explanationText = `Estimated from Front, Left, and Right 2D camera silhouettes using transverse cranial breadth (${headCircumferenceResult.head_breadth_cm} cm), antero-posterior depth (${headCircumferenceResult.head_depth_cm} cm), and Ramanujan's ellipse approximation with inter-view scale calibration. Factored into frame sizing.`;
                  } else if (isUnreliable && headCircumferenceResult?.circumference_cm) {
                    badgeText = 'AI Three-View (Hair Adj)';
                    badgeClass = 'review';
                    valText = `${headCircumferenceResult.circumference_cm} cm`;
                    subText = 'Ramanujan Ellipse (Hair-adjusted)';
                    explanationText = `Estimated from Front, Left, and Right 2D camera silhouettes with hair boundary compensation. Cranial breadth: ${headCircumferenceResult.head_breadth_cm} cm, depth: ${headCircumferenceResult.head_depth_cm} cm.`;
                  } else if (scanMode === 'straight') {
                    badgeText = '3-View Needed';
                    badgeClass = 'camera-na';
                    valText = '3-View Scan Needed';
                    subText = 'Combines front & profile depths';
                    explanationText = 'AI head circumference estimation combines front transverse breadth and side-profile cranial depths to calculate head circumference automatically from 2D images.';
                  } else {
                    badgeText = 'Three-View Ready';
                    badgeClass = 'camera-na';
                    valText = headCircumferenceResult?.circumference_cm ? `${headCircumferenceResult.circumference_cm} cm` : 'Computing...';
                    subText = 'AI Cranial Geometry';
                    explanationText = 'Estimating cranial breadth and depth from your three-view photos.';
                  }

                  return (
                    <div className="param-card">
                      <div>
                        <div className="param-header">
                          <span className="param-title">Head Circumference</span>
                          <span className={`param-badge ${badgeClass}`}>
                            {badgeText}
                          </span>
                        </div>
                        <div className="param-val" style={{
                          fontSize: '1.35rem',
                          color: isAiEstimated ? 'var(--primary)' : isUserEntered ? 'var(--primary)' : isUnreliable ? '#d97706' : 'inherit'
                        }}>
                          {valText}
                        </div>
                        <div className="param-sub">
                          {subText}
                        </div>
                      </div>

                      {/* Sub-metrics breakdown if AI estimated */}
                      {isAiEstimated && (
                        <div style={{
                          margin: '0.45rem 0',
                          padding: '0.4rem 0.55rem',
                          background: 'rgba(15, 118, 110, 0.05)',
                          borderRadius: '6px',
                          fontSize: '0.73rem',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '3px 8px',
                          color: '#334155'
                        }}>
                          <div><strong>Breadth:</strong> {headCircumferenceResult.head_breadth_cm} cm</div>
                          <div><strong>Depth:</strong> {headCircumferenceResult.head_depth_cm} cm</div>
                          <div><strong>Cephalic Index:</strong> {headCircumferenceResult.cephalic_index}</div>
                          <div><strong>Uncertainty:</strong> ±{headCircumferenceResult.uncertainty_interval_cm ? ((headCircumferenceResult.uncertainty_interval_cm[1] - headCircumferenceResult.uncertainty_interval_cm[0]) / 2).toFixed(1) : '1.5'} cm</div>
                        </div>
                      )}

                      <div className="param-explanation">
                        {explanationText}
                      </div>
                    </div>
                  );
                })()}

                {/* 4. Frame Fit Overview */}
                {(() => {
                  const topRec = recommendations && recommendations[0];
                  const isInsufficient = topRec?.fit_status === 'Insufficient data';
                  const hasFrontalFit = isInsufficient && topRec?.front_width_compatibility && topRec?.front_width_compatibility !== 'Insufficient data';

                  let displayBadge = topRec ? topRec.fit_status : "Evaluating";
                  let badgeClass = 'insufficient';
                  let displayVal = topRec ? topRec.fit_status : "Evaluating...";
                  let valColor = 'var(--text-muted)';
                  let displaySub = 'Physical size compatibility';

                  if (topRec?.fit_status === 'Compatible') {
                    badgeClass = 'compatible';
                    valColor = 'var(--success)';
                  } else if (topRec?.fit_status === 'Review Fit') {
                    badgeClass = 'review';
                    valColor = '#d97706';
                  } else if (topRec?.fit_status === 'Unsuitable') {
                    badgeClass = 'unsuitable';
                    valColor = 'var(--error)';
                  } else if (hasFrontalFit) {
                    displayBadge = 'Partial Fit (Front Verified)';
                    badgeClass = 'review';
                    displayVal = 'Front Fit Verified';
                    valColor = 'var(--primary)';
                    displaySub = 'Optical & Width Sizing Verified • Temple Length Unlisted';
                  }

                  return (
                    <div className="param-card">
                      <div>
                        <div className="param-header">
                          <span className="param-title">Frame Fit Prediction</span>
                          <span className={`param-badge ${badgeClass}`}>
                            {displayBadge}
                          </span>
                        </div>
                        <div className="param-val" style={{ color: valColor }}>
                          {displayVal}
                        </div>
                        <div className="param-sub">
                          {displaySub}
                        </div>
                      </div>
                      <div className="param-explanation">
                        {topRec?.fit_explanation
                          ? topRec.fit_explanation
                          : `Compares frame front and optical centers to your ${phase2Result.ipd.ipd_mm.toFixed(1)} mm IPD.`}
                      </div>
                      {topRec?.missing_details && topRec.missing_details.length > 0 && (
                        <div style={{
                          marginTop: '0.65rem',
                          padding: '0.6rem 0.8rem',
                          background: hasFrontalFit ? '#f0fdf4' : '#fffbeb',
                          border: hasFrontalFit ? '1px solid #bbf7d0' : '1px solid #fde68a',
                          borderRadius: '6px',
                          fontSize: '0.76rem',
                          color: hasFrontalFit ? '#166534' : '#92400e',
                          textAlign: 'left'
                        }}>
                          <div style={{fontWeight: 700, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '4px'}}>
                            <span>{hasFrontalFit ? 'ℹ️' : '⚠️'}</span> {hasFrontalFit ? 'Catalog Specification Notice:' : 'Missing Information Needed for Verification:'}
                          </div>
                          <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                            {topRec.missing_details.slice(0, 3).map((item, idx) => (
                              <div key={idx} style={{lineHeight: 1.35}}>
                                <strong>• {item.name}:</strong> {item.how_to_provide}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            </div>

            {/* PHYSICAL FACIAL MEASUREMENTS */}
            <div className="panel">
              <span className="section-title">PHYSICAL FACIAL MEASUREMENTS</span>
              <div className="measurements-row">
                <div className="measurement-card">
                  <div className="m-title">IPD</div>
                  <div className="m-val">{phase2Result.ipd.ipd_mm.toFixed(1)} mm</div>
                  <div className="m-desc">Pupil Distance</div>
                </div>
                <div className="measurement-card">
                  <div className="m-title">CHEEKBONE</div>
                  <div className="m-val">{phase2Result?.measurements?.cheekbone_width_mm ? `${phase2Result.measurements.cheekbone_width_mm.toFixed(1)} mm` : 'Not available'}</div>
                  <div className="m-desc">Face Width</div>
                </div>
                <div className="measurement-card">
                  <div className="m-title">FOREHEAD</div>
                  <div className="m-val">{phase2Result?.measurements?.forehead_width_mm ? `${phase2Result.measurements.forehead_width_mm.toFixed(1)} mm` : 'Not available'}</div>
                  <div className="m-desc">Brow Width</div>
                </div>
                <div className="measurement-card">
                  <div className="m-title">JAWLINE</div>
                  <div className="m-val">{phase2Result?.measurements?.jaw_width_mm ? `${phase2Result.measurements.jaw_width_mm.toFixed(1)} mm` : 'Not available'}</div>
                  <div className="m-desc">Jaw Width</div>
                </div>
                <div className="measurement-card">
                  <div className="m-title">LENGTH</div>
                  <div className="m-val">{phase2Result?.measurements?.face_length_mm ? `${phase2Result.measurements.face_length_mm.toFixed(1)} mm` : 'Not available'}</div>
                  <div className="m-desc">Face Length</div>
                </div>
              </div>
            </div>

            {/* RECOMMENDED FRAMES GRID */}
            <div className="panel">
              <div className="recommendation-header-row" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem', marginBottom: '1.25rem'}}>
                <div>
                  <span className="section-title" style={{margin: 0}}>RECOMMENDED FRAMES FOR YOU</span>
                  <div style={{fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem'}}>
                    Ranked by facial geometry compatibility, color harmony, and optical fit
                  </div>
                </div>

                {/* Filter Controls Bar */}
                <div className="recommendation-filters-bar" style={{display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: 'var(--panel-bg)', padding: '0.45rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border)'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                    <label htmlFor="budget-filter" style={{fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)'}}>
                      Max Budget:
                    </label>
                    <select
                      id="budget-filter"
                      value={maxBudget}
                      onChange={(e) => setMaxBudget(e.target.value)}
                      style={{padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '0.82rem', background: '#fff', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer'}}
                    >
                      <option value="">All Budgets</option>
                      <option value="1500">Under ₹1,500</option>
                      <option value="2000">Under ₹2,000</option>
                      <option value="2500">Under ₹2,500</option>
                      <option value="3500">Under ₹3,500</option>
                      <option value="5000">Under ₹5,000</option>
                    </select>
                  </div>

                  <div style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                    <label htmlFor="color-filter" style={{fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)'}}>
                      Color:
                    </label>
                    <select
                      id="color-filter"
                      value={preferredColor}
                      onChange={(e) => setPreferredColor(e.target.value)}
                      style={{padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '0.82rem', background: '#fff', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer'}}
                    >
                      <option value="">All Colors</option>
                      <option value="Black">Black</option>
                      <option value="Brown">Brown</option>
                      <option value="Tortoise">Tortoise</option>
                      <option value="Gold">Gold</option>
                      <option value="Silver">Silver</option>
                      <option value="Blue">Blue</option>
                      <option value="Red">Red</option>
                    </select>
                  </div>

                  {(maxBudget || preferredColor) && (
                    <button
                      onClick={() => { setMaxBudget(''); setPreferredColor(''); }}
                      style={{padding: '4px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600}}
                      title="Clear filters"
                    >
                      ✕ Reset
                    </button>
                  )}
                </div>
              </div>

            {isLoadingRecs ? (
              <div className="secondary-stat">Calculating scores based on your features...</div>
            ) : recommendations && recommendations.length > 0 ? (
              <div className="frames-grid">
                {recommendations.map(frame => {
                  const sizeBadge = getFrameSizeBadge(frame.frame_width_mm);
                  const budgetBadge = getBudgetBadge(frame.price, maxBudget);
                  const fitBadge = getVisualFitStatusBadge(frame);
                  const hasPrice = frame.price && frame.price !== 'N/A' && frame.price !== 'Unavailable';
                  const styleScore = frame.style_compatibility_score != null ? Math.round(frame.style_compatibility_score) : Math.round(frame.final_score);
                  const isExpanded = expandedSpecsId === frame.id;

                  return (
                    <div key={frame.id} className="frame-card" style={{ display: 'flex', flexDirection: 'column', background: '#ffffff', borderRadius: '12px', border: '1px solid var(--border)', padding: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                      
                      {/* 1. Product Image with SVG Placeholder Fallback */}
                      <div className="frame-image-box" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', height: '145px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {!imgError[frame.id] && frame.image ? (
                          <img 
                            src={frame.image} 
                            alt={frame.name} 
                            onError={(e) => {
                              if (e.target.src.endsWith('.jpg')) {
                                e.target.src = e.target.src.replace('.jpg', '.png');
                              } else {
                                setImgError(prev => ({...prev, [frame.id]: true}));
                              }
                            }}
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                          />
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: '6px' }}>
                            <svg width="44" height="22" viewBox="0 0 48 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="9" />
                              <circle cx="36" cy="12" r="9" />
                              <line x1="21" y1="12" x2="27" y2="12" />
                            </svg>
                            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Frame Image</span>
                          </div>
                        )}
                      </div>

                      {/* Card Content */}
                      <div style={{ marginTop: '0.85rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                        
                        {/* 2. Frame Name */}
                        <h4 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem 0', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={frame.name}>
                          {frame.name}
                        </h4>

                        {/* 3. Actual Product Price */}
                        <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <span style={{ fontSize: '1.15rem', fontWeight: 800, color: hasPrice ? '#0d7665' : '#64748b' }}>
                            {hasPrice ? `₹${frame.price}` : 'Price unlisted'}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            • {frame.category}
                          </span>
                        </div>

                        {/* Badges Row: Size, Budget, Style Match, Visual Fit */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '0.75rem' }}>
                          {/* 4. Frame Size Category */}
                          <span style={{ fontSize: '0.74rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: sizeBadge.bg, color: sizeBadge.color }}>
                            📏 {sizeBadge.label}
                          </span>

                          {/* 5. Budget Compatibility */}
                          <span style={{ fontSize: '0.74rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: budgetBadge.bg, color: budgetBadge.color }}>
                            🏷️ {budgetBadge.label}
                          </span>

                          {/* 6. Style Match Percentage */}
                          <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: '#dbeafe', color: '#1d4ed8' }}>
                            ✨ {styleScore}% Match
                          </span>

                          {/* 7. Visual Fit Status */}
                          <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: fitBadge.bg, color: fitBadge.color }}>
                            🎯 {fitBadge.label}
                          </span>
                        </div>

                        {/* Expandable Technical Details Drawer (Clean & Non-intrusive) */}
                        <div style={{ marginTop: 'auto' }}>
                          <button
                            type="button"
                            onClick={() => setExpandedSpecsId(isExpanded ? null : frame.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: '2px 0',
                              fontSize: '0.76rem',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              marginBottom: '0.5rem',
                              fontWeight: 600
                            }}
                          >
                            <span>{isExpanded ? '▲ Hide Details' : '▼ Specifications & Stamp'}</span>
                          </button>

                          {isExpanded && (
                            <div style={{
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              padding: '0.5rem 0.65rem',
                              marginBottom: '0.65rem',
                              fontSize: '0.75rem',
                              color: '#475569',
                              lineHeight: 1.45
                            }}>
                              <div><strong>Width:</strong> {frame.frame_width_mm ? `${frame.frame_width_mm} mm` : 'Unlisted'}</div>
                              <div><strong>Lens (A):</strong> {frame.lens_width_mm ? `${frame.lens_width_mm} mm` : 'Unlisted'}</div>
                              <div><strong>Bridge (DBL):</strong> {frame.bridge_width_mm ? `${frame.bridge_width_mm} mm` : 'Unlisted'}</div>
                              <div><strong>Temple:</strong> {frame.temple_length_mm ? `${frame.temple_length_mm} mm` : 'Unavailable in catalog'}</div>
                              <button
                                type="button"
                                onClick={() => openEditFrameModal(frame)}
                                style={{
                                  marginTop: '4px',
                                  width: '100%',
                                  padding: '3px 6px',
                                  background: '#ffffff',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                ✏️ Update Dimensions
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 8. One Try On Button */}
                      <button 
                        className="btn-card-tryon"
                        style={{
                          width: '100%', 
                          padding: '0.7rem 1rem', 
                          fontSize: '0.92rem', 
                          fontWeight: 700,
                          backgroundColor: '#0d7665',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 6px rgba(13, 118, 101, 0.2)',
                          transition: 'background 0.15s ease'
                        }}
                        onClick={() => { 
                          setTryOnFrame(frame); 
                          setTryOnMode('tryon'); 
                          setShowTryOn(true); 
                        }}
                      >
                        <span>👓</span> Try On
                      </button>

                      {savedFitReports[frame.id] && (
                        <button
                          style={{
                            marginTop: '0.35rem', width: '100%', padding: '0.4rem', background: '#f0fdf4',
                            color: '#15803d', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '0.76rem',
                            fontWeight: 600, cursor: 'pointer'
                          }}
                          onClick={() => setActiveFitReportView(savedFitReports[frame.id])}
                        >
                          ✓ View Fit Report
                        </button>
                      )}

                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{padding: '2.5rem 1rem', textAlign: 'center', background: 'var(--panel-bg)', borderRadius: '8px', border: '1px solid var(--border)'}}>
                <div style={{fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem'}}>
                  No frames match your selected filters
                </div>
                <div style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem'}}>
                  {maxBudget ? `Budget limit: Under ₹${maxBudget}. ` : ''}
                  {preferredColor ? `Color preference: ${preferredColor}. ` : ''}
                  Try expanding your budget limit or selecting another color.
                </div>
                <button 
                  onClick={() => { setMaxBudget(''); setPreferredColor(''); }}
                  style={{padding: '0.45rem 1.1rem', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem'}}
                >
                  Reset Filters
                </button>
              </div>
            )}
            </div>
          </>
        )}
        
        {showTryOn && tryOnFrame && (
          <VirtualTryOn 
            frame={tryOnFrame} 
            allRecommendations={recommendations || []} 
            apiBase={API_BASE}
            leftEyeToEarMm={leftSideResult?.measurements?.eye_to_ear_distance_mm}
            rightEyeToEarMm={rightSideResult?.measurements?.eye_to_ear_distance_mm}
            estimatedTempleLengthMm={rightSideResult?.measurements?.estimated_temple_length_mm || leftSideResult?.measurements?.estimated_temple_length_mm}
            userIpdMm={phase2Result?.ipd?.ipd_mm}
            faceWidthMm={phase2Result?.measurements?.cheekbone_width_mm}
            calibratedMmPerPx={phase2Result?.calibrated_mm_per_px}
            userFaceShape={phase1Result?.face_shape}
            headCircumferenceResult={headCircumferenceResult}
            initialMode={tryOnMode}
            onSaveFitResult={(report, frameObj) => {
              setSavedFitReports(prev => ({
                ...prev,
                [frameObj.id]: { report, frame: frameObj }
              }));
            }}
            onClose={() => setShowTryOn(false)} 
          />
        )}

        {activeFitReportView && (
          <FitStabilityReport
            report={activeFitReportView.report}
            frame={activeFitReportView.frame}
            onRetake={() => {
              const targetFrame = activeFitReportView.frame;
              setActiveFitReportView(null);
              setTryOnFrame(targetFrame);
              setTryOnMode('fit_analysis');
              setShowTryOn(true);
            }}
            onClose={() => setActiveFitReportView(null)}
          />
        )}

        {editingFrame && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem'
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              maxWidth: '540px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Header */}
              <div style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#f8fafc'
              }}>
                <div>
                  <h3 style={{margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)'}}>
                    Frame Specifications: {editingFrame.name}
                  </h3>
                  <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px'}}>
                    ID: {editingFrame.id} • Style: {editingFrame.category}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingFrame(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.25rem',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '4px'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSaveFrameSpecs} style={{padding: '1.25rem', overflowY: 'auto', maxHeight: '75vh'}}>
                <div style={{
                  padding: '0.75rem 0.9rem',
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.78rem',
                  color: '#0369a1',
                  lineHeight: 1.45
                }}>
                  <div style={{fontWeight: 700, marginBottom: '2px'}}>
                    👓 Optical Boxing System Standard:
                  </div>
                  <div>
                    Frames have three numbers stamped on the inside temple arm (e.g. <strong>54 □ 18 140</strong>):
                    <strong> Lens Width</strong> (54 mm), <strong>Bridge Width</strong> (18 mm), and <strong>Temple Length</strong> (140 mm).
                    Entering verified dimensions enables true physical-fit compatibility calculations.
                  </div>
                </div>

                {frameUpdateStatus.error && (
                  <div style={{
                    padding: '0.6rem 0.8rem',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    color: '#b91c1c',
                    fontSize: '0.8rem',
                    marginBottom: '0.75rem'
                  }}>
                    {frameUpdateStatus.error}
                  </div>
                )}

                {frameUpdateStatus.success && (
                  <div style={{
                    padding: '0.6rem 0.8rem',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '6px',
                    color: '#15803d',
                    fontSize: '0.8rem',
                    marginBottom: '0.75rem'
                  }}>
                    {frameUpdateStatus.success}
                  </div>
                )}

                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '1rem'}}>
                  <div>
                    <label style={{display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '3px', color: 'var(--text-primary)'}}>
                      Lens Width (A) [mm] *
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 54"
                      value={frameFormValues.lens_width_mm}
                      onChange={(e) => setFrameFormValues(prev => ({...prev, lens_width_mm: e.target.value}))}
                      style={{width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem'}}
                    />
                    <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>Stamped width per lens</span>
                  </div>

                  <div>
                    <label style={{display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '3px', color: 'var(--text-primary)'}}>
                      Bridge Width (DBL) [mm] *
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 18"
                      value={frameFormValues.bridge_width_mm}
                      onChange={(e) => setFrameFormValues(prev => ({...prev, bridge_width_mm: e.target.value}))}
                      style={{width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem'}}
                    />
                    <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>Distance between lenses</span>
                  </div>

                  <div>
                    <label style={{display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '3px', color: 'var(--text-primary)'}}>
                      Temple Length [mm] *
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 140"
                      value={frameFormValues.temple_length_mm}
                      onChange={(e) => setFrameFormValues(prev => ({...prev, temple_length_mm: e.target.value}))}
                      style={{width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem'}}
                    />
                    <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>Arm length from hinge to tip</span>
                  </div>

                  <div>
                    <label style={{display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '3px', color: 'var(--text-primary)'}}>
                      Frame Front Width [mm] *
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 138"
                      value={frameFormValues.width_mm}
                      onChange={(e) => setFrameFormValues(prev => ({...prev, width_mm: e.target.value}))}
                      style={{width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem'}}
                    />
                    <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>Outer hinge-to-hinge width</span>
                  </div>

                  <div>
                    <label style={{display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '3px', color: 'var(--text-primary)'}}>
                      Lens Height (B) [mm] (Optional)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 40"
                      value={frameFormValues.lens_height_mm}
                      onChange={(e) => setFrameFormValues(prev => ({...prev, lens_height_mm: e.target.value}))}
                      style={{width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem'}}
                    />
                    <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>Vertical lens dimension</span>
                  </div>

                  <div>
                    <label style={{display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '3px', color: 'var(--text-primary)'}}>
                      Price [₹] (Optional)
                    </label>
                    <input
                      type="number"
                      step="1"
                      placeholder="e.g. 1499"
                      value={frameFormValues.price}
                      onChange={(e) => setFrameFormValues(prev => ({...prev, price: e.target.value}))}
                      style={{width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem'}}
                    />
                    <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>Actual retail price in INR</span>
                  </div>
                </div>

                <div style={{display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', borderTop: '1px solid var(--border)', paddingTop: '0.85rem'}}>
                  <button
                    type="button"
                    onClick={() => setEditingFrame(null)}
                    style={{
                      padding: '7px 14px',
                      background: 'none',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={frameUpdateStatus.loading}
                    style={{
                      padding: '7px 16px',
                      background: 'var(--primary)',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      color: '#ffffff',
                      cursor: frameUpdateStatus.loading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {frameUpdateStatus.loading ? 'Saving...' : 'Save & Verify Fit'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
