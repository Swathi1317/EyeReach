import React, { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import FitStabilityReport from './FitStabilityReport';

const FaceMesh = window.FaceMesh;
const Camera = window.Camera;

// Color mapper for frame acetate & metals
function getColorHex(colorName) {
  if (!colorName) return "#1e293b";
  const name = colorName.toLowerCase();
  const map = {
    "black": "#1e293b",
    "gold": "#d4af37",
    "silver": "#94a3b8",
    "gunmetal": "#475569",
    "tortoise": "#5c3a21",
    "brown": "#5c3a21",
    "amber": "#92400e",
    "blue": "#1e3a8a",
    "navy": "#1e3a8a",
    "red": "#b91c1c",
    "burgundy": "#831843",
    "green": "#14532d",
    "clear": "rgba(255,255,255,0.75)",
    "rose": "#fb7185"
  };
  for (let k in map) {
    if (name.includes(k)) return map[k];
  }
  return "#1e293b";
}

// Filter helper: strictly verify genuine realistic optical frame photographs
// Excludes cartoon drawings, clip-art spectacles, animated-looking glasses, or artificial SVG illustrations
export function isGenuineOpticalFrame(frameObj) {
  if (!frameObj) return false;
  const rawPath = (frameObj.image || frameObj.front_image || frameObj.img_url || '').trim().toLowerCase();
  if (!rawPath) return false;

  // STRICTLY EXCLUDE cartoon drawings, clip-art spectacles, animated-looking glasses, or artificial SVG illustrations
  if (
    rawPath.endsWith('.svg') ||
    rawPath.includes('.svg') ||
    rawPath.includes('ai_gen') ||
    rawPath.includes('clipart') ||
    rawPath.includes('cartoon') ||
    rawPath.includes('illustration') ||
    rawPath.includes('vector') ||
    rawPath.includes('drawing') ||
    rawPath.includes('frame_0')
  ) {
    return false;
  }

  // Must be an authentic raster photographic image format (.png, .jpg, .jpeg, .webp)
  const isRasterFormat = (
    rawPath.endsWith('.png') ||
    rawPath.endsWith('.jpg') ||
    rawPath.endsWith('.jpeg') ||
    rawPath.endsWith('.webp') ||
    rawPath.includes('.png?') ||
    rawPath.includes('.jpg?') ||
    rawPath.includes('.jpeg?') ||
    rawPath.includes('.webp?')
  );
  if (!isRasterFormat) return false;

  // Must belong to authentic studio frame catalog (/frames/kaggle/) or uploaded real photos (/uploads/)
  const isAuthenticPath = (
    rawPath.includes('/frames/kaggle/') ||
    rawPath.includes('/uploads/') ||
    rawPath.startsWith('http://') ||
    rawPath.startsWith('https://') ||
    rawPath.startsWith('blob:') ||
    rawPath.startsWith('data:image/')
  );

  return isAuthenticPath;
}

// Lightweight 3D Head Pose Estimator for MediaPipe FaceMesh (solvePnP equivalent)
// Uses pseudo-inverse of 6 standard 3D anthropometric face model points (MODEL_POINTS_6):
// Nose(1), Chin(152), LeftEye(263), RightEye(33), LeftMouth(291), RightMouth(61)


const estimateHeadPoseFromLandmarks = (lm, width = 1280, height = 720) => {
  if (!lm || lm.length < 468 || !lm[1] || !lm[33] || !lm[263] || !lm[10] || !lm[152]) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  // 1. Roll: Optical angle of the inter-pupillary / inter-ocular line in the 2D image plane
  const pR = lm[468] || lm[33];
  const pL = lm[473] || lm[263];
  const eyeDx = (pL.x - pR.x) * width;
  const eyeDy = (pL.y - pR.y) * height;
  const rollFromEyes = Math.atan2(eyeDy, eyeDx) * (180.0 / Math.PI);

  // Perpendicular to facial midline (forehead 10 to chin 152)
  const midDx = (lm[152].x - lm[10].x) * width;
  const midDy = (lm[152].y - lm[10].y) * height;
  const rollFromMidline = (Math.atan2(midDy, midDx) * (180.0 / Math.PI)) - 90.0;
  
  // Blend eye roll with midline roll for high stability even in perspective
  const roll = 0.70 * rollFromEyes + 0.30 * rollFromMidline;

  // 2. Yaw: Multi-cue robust calculation
  // Cue A: Nose displacement relative to outer eye corners
  const eyeMidX = (lm[33].x + lm[263].x) / 2.0;
  const eyeSpan = Math.hypot((lm[263].x - lm[33].x) * width, (lm[263].y - lm[33].y) * height);
  const noseDx = (lm[1].x - eyeMidX) * width;
  const normNose = Math.max(-1.0, Math.min(1.0, noseDx / Math.max(1.0, eyeSpan * 0.45)));
  const yawFromNose = -Math.asin(normNose) * (180.0 / Math.PI);

  // Cue B: Tragus distance asymmetry from nose tip
  // dist(nose, 454) vs dist(nose, 234)
  let yawFromTragus = yawFromNose;
  if (lm[454] && lm[234]) {
    const dR = Math.hypot((lm[1].x - lm[234].x) * width, (lm[1].y - lm[234].y) * height);
    const dL = Math.hypot((lm[1].x - lm[454].x) * width, (lm[1].y - lm[454].y) * height);
    const asym = (dL - dR) / Math.max(1.0, dL + dR);
    yawFromTragus = asym * 105.0;
  }

  // Cue C: Ear Z-depth difference (3D MediaPipe coordinates)
  let yawFromZ = yawFromNose;
  if (lm[454] && lm[234]) {
    const earDz = (lm[454].z || 0) - (lm[234].z || 0);
    const earDx = Math.abs((lm[454].x - lm[234].x) * width);
    yawFromZ = -Math.atan2(earDz * width, Math.max(10.0, earDx)) * (180.0 / Math.PI);
  }

  // Combined weighted yaw (smooth, monotonic across -80° to +80°):
  let yaw = 0.40 * yawFromNose + 0.35 * yawFromTragus + 0.25 * yawFromZ;

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


// Streamlined 3-step Fit Analysis states
const FIT_STEPS = {
  IDLE: 'IDLE',
  FRONT: 'FRONT',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  ANALYZING: 'ANALYZING',
  COMPLETED: 'COMPLETED'
};

// Real-Time Frame Fit Evaluator (Outputs the floating Pill Badge in Camera Viewport)
function evaluateLiveFit(frame, userIpdMm, faceWidthMm, estTempleMm) {
  if (!frame) return { label: 'Fit Ready', bg: '#10b981', icon: '✓', detail: 'Align face in camera' };

  const frameWidth = frame.width_mm || frame.frame_width_mm || null;
  const lensWidth = frame.lens_width_mm || null;
  const bridgeWidth = frame.bridge_width_mm || null;
  const templeLength = frame.temple_length_mm || null;

  // Calculate ideal frame width
  let idealWidth = null;
  if (userIpdMm && userIpdMm >= 50 && userIpdMm <= 80) {
    idealWidth = userIpdMm + 70.0;
  } else if (faceWidthMm && faceWidthMm > 100) {
    idealWidth = faceWidthMm * 0.94;
  }

  // Check width alignment
  if (frameWidth && idealWidth) {
    const diff = frameWidth - idealWidth;
    if (diff > 7.0) {
      return {
        label: 'Frame Too Wide',
        bg: '#ef4444',
        icon: '↔',
        detail: `Frame is +${diff.toFixed(0)}mm wider than ideal (${idealWidth.toFixed(0)}mm)`
      };
    }
    if (diff < -7.0) {
      return {
        label: 'Frame Too Narrow',
        bg: '#ef4444',
        icon: '><',
        detail: `Frame is ${Math.abs(diff).toFixed(0)}mm narrower than ideal (${idealWidth.toFixed(0)}mm)`
      };
    }
    if (diff > 4.0) {
      return {
        label: 'Slightly Wide',
        bg: '#f59e0b',
        icon: '↔',
        detail: `Frame width ${frameWidth}mm is slightly broad (+${diff.toFixed(0)}mm)`
      };
    }
    if (diff < -4.0) {
      return {
        label: 'Slightly Snug',
        bg: '#f59e0b',
        icon: '><',
        detail: `Frame width ${frameWidth}mm is slightly narrow`
      };
    }
  }

  // Check optical decentration if lens & bridge are available
  if (lensWidth && bridgeWidth && userIpdMm) {
    const framePd = lensWidth + bridgeWidth;
    const decentration = Math.abs(framePd - userIpdMm) / 2.0;
    if (decentration > 5.5) {
      return {
        label: 'High Decentration',
        bg: '#f59e0b',
        icon: '👁️',
        detail: `Pupil decentration is ${decentration.toFixed(1)}mm/eye`
      };
    }
  }

  // Check temple length if available
  if (templeLength && estTempleMm) {
    const tDiff = templeLength - estTempleMm;
    if (tDiff > 16.0) {
      return {
        label: 'Temple Long',
        bg: '#f59e0b',
        icon: '📏',
        detail: `Temple length (${templeLength}mm) may extend past ear`
      };
    }
    if (tDiff < -14.0) {
      return {
        label: 'Temple Short',
        bg: '#f59e0b',
        icon: '📏',
        detail: `Temple length (${templeLength}mm) may feel snug behind ear`
      };
    }
  }

  // Optimal fit confirmed
  return {
    label: 'Good Fit',
    bg: '#10b981',
    icon: '✓',
    detail: idealWidth ? `Width ${frameWidth || ''}mm matches facial structure (${idealWidth.toFixed(0)}mm)` : 'Proportions well-balanced'
  };
}

export default function VirtualTryOn({ 
  frame, 
  allRecommendations = [], 
  apiBase, 
  leftEyeToEarMm, 
  rightEyeToEarMm, 
  estimatedTempleLengthMm, 
  userIpdMm,
  faceWidthMm,
  calibratedMmPerPx,
  userFaceShape,
  headCircumferenceResult,
  initialMode = 'tryon',
  onSaveFitResult,
  onClose 
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameImgRef = useRef(null);
  const offCanvasRef = useRef(null);
  
  // Filter all recommendations to display ONLY genuine realistic optical frame photographs
  // Strictly excludes cartoon drawings, clip-art spectacles, or artificial SVG illustrations
  const genuineFrames = React.useMemo(() => {
    return (allRecommendations || []).filter(isGenuineOpticalFrame);
  }, [allRecommendations]);

  // Determine initial active frame, ensuring it is a genuine optical frame
  const initialValidFrame = isGenuineOpticalFrame(frame) 
    ? frame 
    : (genuineFrames.length > 0 ? genuineFrames[0] : null);

  const [activeFrame, setActiveFrame] = useState(initialValidFrame);
  const activeFrameRef = useRef(initialValidFrame);
  useEffect(() => {
    activeFrameRef.current = activeFrame;
  }, [activeFrame]);

  // Track unverified or failed frame images for review (never silent fallback to cartoon SVG)
  const [unverifiedImages, setUnverifiedImages] = useState({});
  const handleImageError = useCallback((frameId, frameName, src) => {
    console.warn(`[VirtualTryOn Review Required] Frame image failed verification or loading: "${frameName}" (ID: ${frameId}, src: ${src}).`);
    setUnverifiedImages(prev => ({
      ...prev,
      [frameId]: { name: frameName, src, reportedAt: new Date().toISOString() }
    }));
  }, []);

  // Synchronize activeFrame with incoming prop, ensuring cartoon/SVG frames are filtered
  useEffect(() => {
    if (isGenuineOpticalFrame(frame)) {
      setActiveFrame(frame);
    } else if (genuineFrames.length > 0) {
      if (frame) {
        console.warn(`[VirtualTryOn] Excluded non-genuine/SVG frame "${frame.name || frame.id}". Defaulted to authentic studio frame "${genuineFrames[0].name}".`);
      }
      setActiveFrame(genuineFrames[0]);
    }
  }, [frame, genuineFrames]);

  const [status, setStatus] = useState("Initializing...");
  const statusRef = useRef("Initializing...");
  const updateStatus = useCallback((newStatus) => {
    if (statusRef.current !== newStatus) {
      statusRef.current = newStatus;
      setStatus(newStatus);
    }
  }, []);

  const [capturedImage, setCapturedImage] = useState(null);
  const [uploadedImage, setUploadedImage] = useState(null);
  const uploadedImageRef = useRef(null);

  // Fit & Stability Analysis state
  const [isFitAnalysisActive, setIsFitAnalysisActive] = useState(initialMode === 'fit_analysis');
  const [fitStep, setFitStep] = useState(FIT_STEPS.IDLE);
  const [stabilityProgress, setStabilityProgress] = useState(0);
  const [liveGuidance, setLiveGuidance] = useState({ main: '', sub: '', corrective: false });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fitReport, setFitReport] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  
  // Real-time live fit status badge
  const [liveFitBadge, setLiveFitBadge] = useState({ label: 'Good Fit', bg: '#10b981', icon: '✓', detail: '' });

  // Real-time Diagnostic HUD State (Clean default: OFF to never obstruct user face)
  const [showTryOnHud, setShowTryOnHud] = useState(false);
  const [tryOnTelemetry, setTryOnTelemetry] = useState({ yaw: 0, pitch: 0, roll: 0, ipdPx: 0, pose: 'FRONT' });
  const lastTelemetryUpdateRef = useRef(0);

  // Side Temple Arms visibility (enabled by default with correct anatomical geometry: hidden front, visible on turn)
  const [showTempleArms, setShowTempleArms] = useState(true);

  // Update live fit badge whenever frame changes
  useEffect(() => {
    const badge = evaluateLiveFit(activeFrame, userIpdMm, faceWidthMm, estimatedTempleLengthMm);
    setLiveFitBadge(badge);
  }, [activeFrame, userIpdMm, faceWidthMm, estimatedTempleLengthMm]);

  // Frame navigation indices over genuine authentic studio frames
  const currentFrameIndex = genuineFrames.findIndex(r => r.id === activeFrame?.id);

  const handlePrevFrame = useCallback(() => {
    if (!genuineFrames || genuineFrames.length <= 1) return;
    const prevIdx = (currentFrameIndex - 1 + genuineFrames.length) % genuineFrames.length;
    setActiveFrame(genuineFrames[prevIdx]);
    setFitReport(null);
  }, [currentFrameIndex, genuineFrames]);

  const handleNextFrame = useCallback(() => {
    if (!genuineFrames || genuineFrames.length <= 1) return;
    const nextIdx = (currentFrameIndex + 1) % genuineFrames.length;
    setActiveFrame(genuineFrames[nextIdx]);
    setFitReport(null);
  }, [currentFrameIndex, genuineFrames]);

  // Keyboard navigation for frame carousel
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') handlePrevFrame();
      if (e.key === 'ArrowRight') handleNextFrame();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevFrame, handleNextFrame, onClose]);

  // Reset smoothing on frame change so new glasses snap immediately into place
  // In Photo Upload mode, re-process the face photo with the newly selected frame
  useEffect(() => {
    smoothPos.current = { 
      x: 0, y: 0, width: 0, angle: 0, 
      yawDeg: 0, pitchDeg: 0, rollDeg: 0,
      earApexRx: 0, earApexRy: 0, earDropRx: 0, earDropRy: 0,
      earApexLx: 0, earApexLy: 0, earDropLx: 0, earDropLy: 0
    };
    if (uploadedImage && uploadedImageRef.current && engineRef.current?.faceMesh) {
      engineRef.current.faceMesh.send({ image: uploadedImageRef.current }).catch(() => {});
    }
  }, [activeFrame, uploadedImage]);

  // Smoothing state refs for jitter-free 3D rendering
  const smoothPos = useRef({ 
    x: 0, y: 0, width: 0, angle: 0, 
    yawDeg: 0, pitchDeg: 0, rollDeg: 0,
    earApexRx: 0, earApexRy: 0, earDropRx: 0, earDropRy: 0,
    earApexLx: 0, earApexLy: 0, earDropLx: 0, earDropLy: 0
  });
  
  const engineRef = useRef({ isActive: true, camera: null, faceMesh: null });
  const fitStepRef = useRef(FIT_STEPS.IDLE);
  const stabilityCountRef = useRef(0);
  const isCapturingRef = useRef(false);
  const lastSpokenWrongTurnRef = useRef(0);
  const capturedBlobsRef = useRef({
    front: null,
    left: null,
    right: null
  });
  const motionMetricsRef = useRef({
    initialBridgeY: 0,
    maxDisplacementPx: 0,
    tiltDeltaDeg: 0
  });

  // Keep fitStepRef in sync
  useEffect(() => {
    fitStepRef.current = fitStep;
  }, [fitStep]);

  const isFitAnalysisActiveRef = useRef(isFitAnalysisActive);
  useEffect(() => {
    isFitAnalysisActiveRef.current = isFitAnalysisActive;
  }, [isFitAnalysisActive]);

  const lostTrackingCountRef = useRef(0);

  useEffect(() => {
    setActiveFrame(frame);
  }, [frame]);

  // Audio capture chime
  const playCaptureChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(880.0, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } catch (e) {}
  };

  // Voice guidance TTS
  const speakVoice = (text, onEnd) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => 
        (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha") || v.name.includes("David")) && 
        v.lang.startsWith("en")
      ) || voices.find(v => v.lang.startsWith("en"));
      if (preferred) utterance.voice = preferred;
      if (onEnd) utterance.onend = onEnd;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("TTS error:", e);
    }
  };

  const speakVoiceAsync = (text) => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }
      let settled = false;
      const safeResolve = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const safetyTimeout = setTimeout(safeResolve, Math.max(1800, text.length * 85));
      speakVoice(text, () => {
        clearTimeout(safetyTimeout);
        safeResolve();
      });
    });
  };

  const captureCanvasBlobAsync = () => {
    return new Promise((resolve) => {
      if (!canvasRef.current) {
        resolve(null);
        return;
      }
      const canvas = canvasRef.current;
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.90);
    });
  };

  // Initialize offscreen scratch canvas
  if (!offCanvasRef.current && typeof document !== 'undefined') {
    offCanvasRef.current = document.createElement('canvas');
  }

  // FaceMesh initialization and render loop
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    engineRef.current.isActive = true;
    
    const faceMesh = new FaceMesh({
      locateFile: (file) => `/mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55
    });

    engineRef.current.faceMesh = faceMesh;

    faceMesh.onResults(async (results) => {
      if (!engineRef.current.isActive) return;
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        updateStatus("");
        lostTrackingCountRef.current = 0;
        const landmarks = results.multiFaceLandmarks[0];
        
        const w = canvas.width;
        const h = canvas.height;

        // Accurate 3D Head Pose (yaw, pitch, roll in physical degrees)
        const { yaw: rawYawDeg, pitch: rawPitchDeg, roll: rawRollDeg } = estimateHeadPoseFromLandmarks(landmarks, w, h);

        // MediaPipe Refined Iris / Pupil Centers (468: Right Pupil, 473: Left Pupil)
        const pupilR = landmarks[468] || {
          x: ((landmarks[33]?.x || 0.35) + (landmarks[133]?.x || 0.45)) / 2,
          y: ((landmarks[33]?.y || 0.35) + (landmarks[133]?.y || 0.35)) / 2
        };
        const pupilL = landmarks[473] || {
          x: ((landmarks[263]?.x || 0.65) + (landmarks[362]?.x || 0.55)) / 2,
          y: ((landmarks[263]?.y || 0.35) + (landmarks[362]?.y || 0.35)) / 2
        };

        const pupilsMidX = ((pupilR.x + pupilL.x) / 2) * w;
        const pupilsMidY = ((pupilR.y + pupilL.y) / 2) * h;

        // Nasal bridge saddle point (landmark 168 / 6)
        const bridgePt = landmarks[168] || landmarks[6] || landmarks[1];
        const bridgeX = bridgePt.x * w;
        const bridgeY = bridgePt.y * h;

        const noseTip = landmarks[1];
        const chin = landmarks[152];
        const forehead = landmarks[10];

        // Anatomical reference points in unmirrored camera coordinates:
        // (X: 0 = camera left / anatomical right; 1 = camera right / anatomical left)
        const eyeCornerR = landmarks[33];   // Anatomical Right outer eye corner
        const eyeCornerL = landmarks[263];  // Anatomical Left outer eye corner

        const tragusR = landmarks[234];     // Anatomical Right ear tragus / preauricular root
        const tragusL = landmarks[454];     // Anatomical Left ear tragus / preauricular root

        // Otobasion Superius (Ear Apex attachment at superior root of pinna)
        // Directly maps to anatomical ear crest: lm 127 (Right Ear) and lm 356 (Left Ear)
        const helixRootR = landmarks[127] || landmarks[234] || landmarks[162];
        const helixRootL = landmarks[356] || landmarks[454] || landmarks[389];

        const faceHeight = Math.hypot((chin.x - forehead.x) * w, (chin.y - forehead.y) * h);
        const faceWidth = Math.hypot((tragusL.x - tragusR.x) * w, (tragusL.y - tragusR.y) * h);

        // Frame temple arm dimensions:
        // Incorporate frame temple_length_mm (defaulting to 140mm) and pxPerMm scale
        const frameTempleMm = activeFrame?.temple_length_mm || 140.0;
        // Mastoid drop extension behind ear is ~28% of total temple length
        const mastoidDropPx = Math.max(14.0, (frameTempleMm * 0.28) * (faceHeight * 0.0035));

        const targetApexRx = helixRootR.x * w;
        const targetApexRy = helixRootR.y * h;
        const targetDropRx = targetApexRx - (mastoidDropPx * 0.35);
        const targetDropRy = targetApexRy + (mastoidDropPx * 0.85);

        const targetApexLx = helixRootL.x * w;
        const targetApexLy = helixRootL.y * h;
        const targetDropLx = targetApexLx + (mastoidDropPx * 0.35);
        const targetDropLy = targetApexLy + (mastoidDropPx * 0.85);

        // Head roll angle:
        // Interocular line (between eye pupils / corners) directly defines the true optical horizontal tilt.
        const dx = (pupilL.x - pupilR.x) * w; 
        const dy = (pupilL.y - pupilR.y) * h;
        const eyeRollRad = Math.atan2(dy, dx);
        
        // Glasses roll angle follows the optical interocular tilt, clamped defensively to +-35 deg
        let rollAngleRad = Math.max(-0.61, Math.min(0.61, eyeRollRad));
        const ipdPx = Math.hypot(dx, dy);

        // Robust 3D physical scaling:
        // In 3D space, distance between eyes and vertical face height are invariant to horizontal head yaw.
        // This completely prevents the frame from collapsing or shrinking when the user turns left/right.
        const eyeSpan3DPx = Math.hypot(
          (eyeCornerL.x - eyeCornerR.x) * w,
          (eyeCornerL.y - eyeCornerR.y) * h,
          ((eyeCornerL.z || 0) - (eyeCornerR.z || 0)) * w
        );
        const faceHeightPx = Math.hypot((chin.x - forehead.x) * w, (chin.y - forehead.y) * h);
        
        // Accurate facial px/mm scale:
        // Incorporates direct pupillary scale (ipdPx / userIpdMm) when calibrated IPD is available
        // Accurate facial px/mm scale:
        // Prioritizes direct pupillary scale (ipdPx / userIpdMm) when calibrated IPD is available,
        // or uses invariant horizontal outer eye span (landmark 33 to 263 = ~96mm)
        let pxPerMm;
        if (userIpdMm && userIpdMm >= 50 && userIpdMm <= 75 && ipdPx > 25) {
          const directIpdScale = ipdPx / userIpdMm;
          const anthropometricScale = eyeSpan3DPx / 96.0;
          pxPerMm = 0.70 * directIpdScale + 0.30 * anthropometricScale;
        } else {
          pxPerMm = eyeSpan3DPx / 96.0;
        }
        
        const curFrame = activeFrameRef.current || activeFrame;
        const frameWidthMm = curFrame?.frame_width_mm || curFrame?.width_mm || 136.0;
        const targetWidth = frameWidthMm * pxPerMm;

        // Eyewear placement:
        // Anchors bridge saddle point to nasal bridge landmark 168 at natural eye height
        const bridgeWeight = Math.min(1.0, 0.80 + Math.abs(rawYawDeg) / 100.0);
        const targetX = bridgeX * bridgeWeight + pupilsMidX * (1.0 - bridgeWeight);
        const targetY = bridgeY * 0.75 + pupilsMidY * 0.25;
        
        const smooth = smoothPos.current;
        
        if (smooth.width === 0 || uploadedImage) {
          smooth.x = targetX;
          smooth.y = targetY;
          smooth.width = targetWidth;
          smooth.angle = rollAngleRad;
          smooth.yawDeg = rawYawDeg;
          smooth.pitchDeg = rawPitchDeg;
          smooth.rollDeg = rawRollDeg;
          smooth.earApexRx = targetApexRx;
          smooth.earApexRy = targetApexRy;
          smooth.earDropRx = targetDropRx;
          smooth.earDropRy = targetDropRy;
          smooth.earApexLx = targetApexLx;
          smooth.earApexLy = targetApexLy;
          smooth.earDropLx = targetDropLx;
          smooth.earDropLy = targetDropLy;
        } else {
          // Dynamic tracking responsiveness:
          // If the user turns their head swiftly, increase tracking rate to eliminate lag/drift
          const yawDelta = Math.abs(rawYawDeg - smooth.yawDeg);
          const alpha = yawDelta > 8.0 ? 0.65 : 0.40;
          const beta = 1.0 - alpha;

          smooth.x = smooth.x * beta + targetX * alpha;
          smooth.y = smooth.y * beta + targetY * alpha;
          smooth.width = smooth.width * 0.70 + targetWidth * 0.30;
          smooth.angle = smooth.angle * beta + rollAngleRad * alpha;
          smooth.yawDeg = smooth.yawDeg * beta + rawYawDeg * alpha;
          smooth.pitchDeg = smooth.pitchDeg * beta + rawPitchDeg * alpha;
          smooth.rollDeg = smooth.rollDeg * beta + rawRollDeg * alpha;
          smooth.earApexRx = smooth.earApexRx * beta + targetApexRx * alpha;
          smooth.earApexRy = smooth.earApexRy * beta + targetApexRy * alpha;
          smooth.earDropRx = smooth.earDropRx * beta + targetDropRx * alpha;
          smooth.earDropRy = smooth.earDropRy * beta + targetDropRy * alpha;
          smooth.earApexLx = smooth.earApexLx * beta + targetApexLx * alpha;
          smooth.earApexLy = smooth.earApexLy * beta + targetApexLy * alpha;
          smooth.earDropLx = smooth.earDropLx * beta + targetDropLx * alpha;
          smooth.earDropLy = smooth.earDropLy * beta + targetDropLy * alpha;
        }
// =====================================================================
        // THREE CORRECTLY POSITIONED VISUAL PARTS:
        // 1. FRONT FRAME CHASSIS (Centered, bridge on nose, clear lenses)
        // 2. RIGHT TEMPLE ARM (From right hinge outward along skull to right ear)
        // 3. LEFT TEMPLE ARM (From left hinge outward along skull to left ear)
        // =====================================================================
        if (frameImgRef.current && frameImgRef.current.complete && frameImgRef.current.naturalWidth > 0) {
          const img = frameImgRef.current;
          
          // Full front frame chassis rendered completely (never half-shown)
          const aspect = img.naturalHeight / img.naturalWidth;
          
          const nX = smooth.x;
          const nY = smooth.y;
          const baseDrawW = smooth.width;
          
          // Realistic 3D perspective foreshortening in side-profile:
          const yawRad = (smooth.yawDeg * Math.PI) / 180.0;
          const absYawDeg = Math.abs(smooth.yawDeg);
          const foreshortenFactor = Math.max(0.35, Math.cos(Math.min(1.40, Math.abs(yawRad))));
          const drawW = baseDrawW * foreshortenFactor;
          const drawH = baseDrawW * aspect;
          
          const slices = 24;
          const sliceW = img.naturalWidth / slices;
          const focal = drawW * 2.2; 
          
          // Anatomical bridge alignment (centers bridge saddle point on nasal bridge landmark 168)
          const sliceDy = -drawH * 0.42;
          
          let hinges = { 
            rightX: -drawW / 2, 
            rightY: sliceDy + drawH * 0.35, 
            leftX: drawW / 2, 
            leftY: sliceDy + drawH * 0.35 
          };
          const drawCommands = [];
          
          // Back-to-front slice sorting for proper perspective depth order:
          const sliceIndices = [];
          if (smooth.yawDeg < 0) {
            for (let i = slices - 1; i >= 0; i--) sliceIndices.push(i);
          } else {
            for (let i = 0; i < slices; i++) sliceIndices.push(i);
          }
          
          for (let i = 0; i < slices; i++) {
            const normalizedX = (i / (slices - 1)) - 0.5; // -0.5 is right rim, +0.5 is left rim
            const z = -normalizedX * Math.sin(yawRad) * drawW * 1.1; 
            const scale = focal / (focal + z);
            
            const projX = normalizedX * drawW * scale;
            const projW = (drawW / slices) * scale;
            const projH = drawH * scale;
            const sDy = -projH * 0.42;
            
            const srcX = i * sliceW;
            
            drawCommands[i] = {
              img, srcX, srcY: 0, sw: sliceW, sh: img.naturalHeight,
              dx: projX - projW / 2, dy: sDy, dw: projW * 1.05, dh: projH,
              centerX: projX, centerY: sDy + projH * 0.45, scale
            };
            
            if (i === 0) {
              hinges.rightX = projX - projW / 2;
              hinges.rightY = sDy + projH * 0.35;
            }
            if (i === slices - 1) {
              hinges.leftX = projX + projW / 2;
              hinges.leftY = sDy + projH * 0.35;
            }
          }
          
          // Ear positions transformed into local rotated frame space
          const cosA = Math.cos(smooth.angle);
          const sinA = Math.sin(smooth.angle);
          
          const dApexRx = smooth.earApexRx - nX;
          const dApexRy = smooth.earApexRy - nY;
          const localApexRx = dApexRx * cosA + dApexRy * sinA;
          const localApexRy = -dApexRx * sinA + dApexRy * cosA;

          const dDropRx = smooth.earDropRx - nX;
          const dDropRy = smooth.earDropRy - nY;
          const localDropRx = dDropRx * cosA + dDropRy * sinA;
          const localDropRy = -dDropRx * sinA + dDropRy * cosA;

          const dApexLx = smooth.earApexLx - nX;
          const dApexLy = smooth.earApexLy - nY;
          const localApexLx = dApexLx * cosA + dApexLy * sinA;
          const localApexLy = -dApexLx * sinA + dApexLy * cosA;

          const dDropLx = smooth.earDropLx - nX;
          const dDropLy = smooth.earDropLy - nY;
          const localDropLx = dDropLx * cosA + dDropLy * sinA;
          const localDropLy = -dDropLx * sinA + dDropLy * cosA;

          // =====================================================================
          // =====================================================================
          // REALISTIC LENSKART-STYLE TEMPLE ARM BEHAVIOR:
          // 1. FRONT VIEW (|yaw| <= 8°):
          //    Temple arms point straight back along optical Z-axis (perpendicular
          //    to camera plane) and are 100% occluded behind the front chassis/hinges.
          //    NO side arms are rendered in front view, giving a pristine front fit.
          // 2. WHILE TURNING (|yaw| > 8°):
          //    As the user turns left or right, perspective reveals the near temple arm.
          //    The near arm smoothly fades in and extends from the hinge back along the
          //    temporal skull line directly to the ear crest (otobasion superius).
          //    The far arm remains occluded behind the skull.
          // =====================================================================
          const yawDeg = smooth.yawDeg;
          const absYaw = Math.abs(yawDeg);

          // Near-side temple arm fades in smoothly between 8° and 16° of head rotation
          const turnProgress = Math.min(1.0, Math.max(0.0, (absYaw - 8.0) / 8.0));

          let rightArmAlpha = 0.0;
          let leftArmAlpha = 0.0;

          // RIGHT TEMPLE ARM (Camera-Left / Anatomical Right):
          // Start point: Right frame hinge
          let rStartX = hinges.rightX;
          let rStartY = hinges.rightY;
          // Target point at ear: Must stay lateral to hinge (X <= hinges.rightX - 3px)
          let rEndX = Math.min(hinges.rightX - 3.0, localApexRx);
          let rEndY = localApexRy;
          let rDropX = rEndX - (mastoidDropPx * 0.20);
          let rDropY = rEndY + (mastoidDropPx * 0.65);

          // LEFT TEMPLE ARM (Camera-Right / Anatomical Left):
          // Start point: Left frame hinge
          let lStartX = hinges.leftX;
          let lStartY = hinges.leftY;
          // Target point at ear: Must stay lateral to hinge (X >= hinges.leftX + 3px)
          let lEndX = Math.max(hinges.leftX + 3.0, localApexLx);
          let lEndY = localApexLy;
          let lDropX = lEndX + (mastoidDropPx * 0.20);
          let lDropY = lEndY + (mastoidDropPx * 0.65);

          if (showTempleArms && absYaw > 8.0) {
            if (yawDeg < -8.0) {
              // Turned left: Near side is user's right temple (camera-left)
              rightArmAlpha = turnProgress;
              leftArmAlpha = 0.0; // Far side occluded
            } else if (yawDeg > 8.0) {
              // Turned right: Near side is user's left temple (camera-right)
              leftArmAlpha = turnProgress;
              rightArmAlpha = 0.0; // Far side occluded
            }
          }
          
          // Frame styling attributes
          const frameCat = (activeFrame?.category || '').toLowerCase();
          const frameColorStr = activeFrame?.color || 'Black';
          const isWireFrame = frameCat.includes('aviator') || frameCat.includes('round') || frameColorStr.toLowerCase().includes('gold') || frameColorStr.toLowerCase().includes('silver');
          const isCatEye = frameCat.includes('cat');
          const isBoldAcetate = frameCat.includes('wayfarer') || frameCat.includes('square') || frameCat.includes('rectangle');
          
          const baseArmThickness = isWireFrame 
            ? Math.max(2.8, baseDrawW * 0.016)
            : isCatEye 
            ? Math.max(3.8, baseDrawW * 0.022)
            : Math.max(4.5, baseDrawW * 0.028);

          // REALISTIC 3D TEMPLE ARM RENDERER
          // Extends from frame hinge along skull directly to Otobasion Superius and hooks behind ear
          const renderTempleArm = (startX, startY, apexX, apexY, dropX, dropY, alpha = 1.0) => {
            if (alpha <= 0.01) return;
            ctx.save();
            ctx.globalAlpha = Math.min(1.0, Math.max(0.0, alpha));
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            // Mid-shaft temporal curve point following cranial bone
            const cpX = (startX + apexX) / 2.0 + (apexX < startX ? -2.5 : 2.5);
            const cpY = startY + (apexY - startY) * 0.25 - (isCatEye ? 3 : 1.5);

            // 1. Ambient drop shadow
            ctx.lineWidth = baseArmThickness + 2.0;
            ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
            ctx.beginPath();
            ctx.moveTo(startX, startY + 1.5);
            ctx.quadraticCurveTo(cpX, cpY + 1.5, apexX, apexY + 1.5);
            if (dropX !== apexX || dropY !== apexY) {
              ctx.lineTo(dropX, dropY + 1.5);
            }
            ctx.stroke();

            // 2. Main 3D Cylindrical Temple Arm Body
            ctx.lineWidth = baseArmThickness;
            const grad = ctx.createLinearGradient(startX, startY - baseArmThickness, startX, startY + baseArmThickness);
            
            if (frameColorStr.toLowerCase().includes('gold')) {
              grad.addColorStop(0, "#fef08a");
              grad.addColorStop(0.4, "#d4af37");
              grad.addColorStop(1, "#854d0e");
            } else if (frameColorStr.toLowerCase().includes('silver')) {
              grad.addColorStop(0, "#f8fafc");
              grad.addColorStop(0.4, "#cbd5e1");
              grad.addColorStop(1, "#475569");
            } else if (frameColorStr.toLowerCase().includes('tortoise') || frameColorStr.toLowerCase().includes('brown')) {
              grad.addColorStop(0, "#92400e");
              grad.addColorStop(0.4, "#5c3a21");
              grad.addColorStop(1, "#29180c");
            } else {
              // Obsidian Black / Premium Acetate
              grad.addColorStop(0, "#475569");
              grad.addColorStop(0.35, "#1e293b");
              grad.addColorStop(1, "#090d16");
            }

            ctx.strokeStyle = grad;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.quadraticCurveTo(cpX, cpY, apexX, apexY);
            if (dropX !== apexX || dropY !== apexY) {
              ctx.lineTo(dropX, dropY);
            }
            ctx.stroke();

            // 3. Specular highlight line
            ctx.lineWidth = Math.max(1.0, baseArmThickness * 0.24);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
            ctx.beginPath();
            ctx.moveTo(startX, startY - baseArmThickness * 0.18);
            ctx.quadraticCurveTo(cpX, cpY - baseArmThickness * 0.18, apexX, apexY - baseArmThickness * 0.18);
            ctx.stroke();

            // 4. Acetate Ear Sock for Wire / Aviator frames
            if (isWireFrame && (dropX !== apexX || dropY !== apexY)) {
              ctx.lineWidth = baseArmThickness + 1.8;
              ctx.strokeStyle = "#1e293b";
              ctx.beginPath();
              ctx.moveTo(apexX + (dropX - apexX) * 0.15, apexY + (dropY - apexY) * 0.15);
              ctx.lineTo(dropX, dropY);
              ctx.stroke();
            }

            // 5. Subtle Metallic Hinge Pin Hardware Accent
            ctx.fillStyle = frameColorStr.toLowerCase().includes('gold') ? "#b45309" : "#64748b";
            ctx.beginPath();
            ctx.arc(startX, startY, Math.min(2.0, baseArmThickness * 0.32), 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          };

          ctx.save();
          ctx.translate(nX, nY);
          ctx.rotate(smooth.angle);

          // DRAW TEMPLE ARMS (Extending from frame hinges outward along sides of head)
          if (rightArmAlpha > 0.01) {
            renderTempleArm(rStartX, rStartY, rEndX, rEndY, rDropX, rDropY, rightArmAlpha);
          }
          if (leftArmAlpha > 0.01) {
            renderTempleArm(lStartX, lStartY, lEndX, lEndY, lDropX, lDropY, leftArmAlpha);
          }

          // FRONT FRAME CHASSIS
          const offCanvas = offCanvasRef.current;
          const offW = Math.max(10, Math.ceil(drawW * 1.3));
          const offH = Math.max(10, Math.ceil(drawH * 1.3));
          if (offCanvas.width !== offW || offCanvas.height !== offH) {
            offCanvas.width = offW;
            offCanvas.height = offH;
          }
          const offCtx = offCanvas.getContext('2d');
          offCtx.clearRect(0, 0, offW, offH);

          const offCenterX = offW / 2;
          const offCenterY = offH / 2;

          if (absYawDeg < 2.5) {
            // Front-facing direct render: maximum optical clarity, zero slicing artifacts
            offCtx.drawImage(img, offCenterX - drawW / 2, offCenterY + sliceDy, drawW, drawH);
          } else {
            // 3D perspective slice rendering for natural left/right head turn tracking
            for (let idx of sliceIndices) {
              const cmd = drawCommands[idx];
              offCtx.drawImage(
                cmd.img, cmd.srcX, cmd.srcY, cmd.sw, cmd.sh, 
                offCenterX + cmd.dx, offCenterY + cmd.dy, cmd.dw, cmd.dh
              );
            }
          }

          // Lens dimensions for punchout & AR sheen
          const rSliceIdx = Math.round(slices * 0.25);
          const lSliceIdx = Math.round(slices * 0.75);
          const cmdR = drawCommands[rSliceIdx] || drawCommands[0];
          const cmdL = drawCommands[lSliceIdx] || drawCommands[slices - 1];

          const rLensW = (drawW * 0.16) * (cmdR.scale || 1.0);
          const rLensH = (drawH * 0.33) * (cmdR.scale || 1.0);
          const lLensW = (drawW * 0.16) * (cmdL.scale || 1.0);
          const lLensH = (drawH * 0.33) * (cmdL.scale || 1.0);

          // Helper to draw clean anatomical lens aperture path (handles wire, rectangular, square & cat-eye)
          const drawLensAperture = (tCtx, cx, cy, rw, rh, tilt = 0) => {
            tCtx.save();
            tCtx.translate(cx, cy);
            if (tilt !== 0) tCtx.rotate(tilt);
            tCtx.beginPath();
            if (isWireFrame) {
              tCtx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
            } else {
              const cr = Math.min(rw, rh) * 0.32;
              const lx = -rw, ly = -rh, lw = rw * 2, lh = rh * 2;
              if (typeof tCtx.roundRect === 'function') {
                tCtx.roundRect(lx, ly, lw, lh, cr);
              } else {
                tCtx.moveTo(lx + cr, ly);
                tCtx.lineTo(lx + lw - cr, ly);
                tCtx.quadraticCurveTo(lx + lw, ly, lx + lw, ly + cr);
                tCtx.lineTo(lx + lw, ly + lh - cr);
                tCtx.quadraticCurveTo(lx + lw, ly + lh, lx + lw - cr, ly + lh);
                tCtx.lineTo(lx + cr, ly + lh);
                tCtx.quadraticCurveTo(lx, ly + lh, lx, ly + lh - cr);
                tCtx.lineTo(lx, ly + cr);
                tCtx.quadraticCurveTo(lx, ly, lx + cr, ly);
                tCtx.closePath();
              }
            }
            tCtx.restore();
          };

          // 1. PUNCH OUT INTERIOR LENS APERTURES (Lenskart Crystal-Clear Optical Physics):
          // Guarantees 100% transparent clear lenses so the user's real eyes, eyelids,
          // and skin are visible with zero folded temple arms, reflections, or obstructions.
          offCtx.save();
          offCtx.globalCompositeOperation = 'destination-out';
          drawLensAperture(offCtx, offCenterX + cmdR.centerX, offCenterY + cmdR.centerY, rLensW * 0.90, rLensH * 0.86, isCatEye ? -0.10 : 0);
          offCtx.fill();

          drawLensAperture(offCtx, offCenterX + cmdL.centerX, offCenterY + cmdL.centerY, lLensW * 0.90, lLensH * 0.86, isCatEye ? 0.10 : 0);
          offCtx.fill();
          offCtx.restore();

          // 2. Subtle anti-reflective optical sheen across transparent lens apertures
          offCtx.save();
          offCtx.globalCompositeOperation = 'source-over';
          
          const arGradR = offCtx.createLinearGradient(
            offCenterX + cmdR.centerX - rLensW, offCenterY + cmdR.centerY - rLensH,
            offCenterX + cmdR.centerX + rLensW, offCenterY + cmdR.centerY + rLensH
          );
          arGradR.addColorStop(0, "rgba(255, 255, 255, 0.08)");
          arGradR.addColorStop(0.35, "rgba(56, 189, 248, 0.035)");
          arGradR.addColorStop(1, "rgba(255, 255, 255, 0.00)");
          offCtx.fillStyle = arGradR;
          drawLensAperture(offCtx, offCenterX + cmdR.centerX, offCenterY + cmdR.centerY, rLensW * 0.92, rLensH * 0.88, isCatEye ? -0.10 : 0);
          offCtx.fill();

          const arGradL = offCtx.createLinearGradient(
            offCenterX + cmdL.centerX - lLensW, offCenterY + cmdL.centerY - lLensH,
            offCenterX + cmdL.centerX + lLensW, offCenterY + cmdL.centerY + lLensH
          );
          arGradL.addColorStop(0, "rgba(255, 255, 255, 0.08)");
          arGradL.addColorStop(0.35, "rgba(56, 189, 248, 0.035)");
          arGradL.addColorStop(1, "rgba(255, 255, 255, 0.00)");
          offCtx.fillStyle = arGradL;
          drawLensAperture(offCtx, offCenterX + cmdL.centerX, offCenterY + cmdL.centerY, lLensW * 0.92, lLensH * 0.88, isCatEye ? 0.10 : 0);
          offCtx.fill();
          offCtx.restore();

          // Render pristine front frame chassis onto the main canvas
          ctx.drawImage(offCanvas, -offCenterX, -offCenterY);

          ctx.restore();
        }

        // Live Diagnostic HUD telemetry update throttled to ~200ms with equality check
        const telemetryNow = performance.now();
        if (telemetryNow - lastTelemetryUpdateRef.current > 200) {
          lastTelemetryUpdateRef.current = telemetryNow;
          const poseLabel = Math.abs(smooth.yawDeg) <= 12 ? 'FRONT' : smooth.yawDeg < -12 ? 'LEFT PROFILE' : 'RIGHT PROFILE';
          const nextYaw = Math.round(smooth.yawDeg);
          const nextPitch = Math.round(smooth.pitchDeg);
          const nextRoll = Math.round(smooth.rollDeg);
          const nextIpd = Math.round(ipdPx);
          setTryOnTelemetry(prev => {
            if (prev.yaw === nextYaw && prev.pitch === nextPitch && prev.roll === nextRoll && prev.ipdPx === nextIpd && prev.pose === poseLabel) {
              return prev;
            }
            return { yaw: nextYaw, pitch: nextPitch, roll: nextRoll, ipdPx: nextIpd, pose: poseLabel };
          });
        }

        // =====================================================================
        // STREAMLINED 3-STEP FIT & STABILITY TRACKING ENGINE
        // (1. Front -> 2. Left Profile -> 3. Right Profile -> Complete Report)
        // =====================================================================
        if (isFitAnalysisActive && !isCapturingRef.current && !isAnalyzing) {
          const currentFitStep = fitStepRef.current;
          
          // STEP 1: FRONT VIEW
          if (currentFitStep === FIT_STEPS.FRONT) {
            const isFacingFront = Math.abs(smooth.yawDeg) <= 12.0 && Math.abs(smooth.rollDeg) <= 12.0 && Math.abs(smooth.pitchDeg) <= 15.0;
            if (isFacingFront) {
              stabilityCountRef.current += 1;
              const prog = Math.min(100, Math.round((stabilityCountRef.current / 12) * 100));
              setStabilityProgress(prog);
              setLiveGuidance({
                main: 'Hold steady...',
                sub: 'Frontal frame alignment verified ✓',
                corrective: false
              });

              if (stabilityCountRef.current >= 12) {
                isCapturingRef.current = true;
                playCaptureChime();
                const blob = await captureCanvasBlobAsync();
                capturedBlobsRef.current.front = blob;
                motionMetricsRef.current.initialBridgeY = bridgePt.y * h;

                setLiveGuidance({
                  main: 'Front view captured.',
                  sub: 'Preparing for left profile...',
                  corrective: false
                });

                await speakVoiceAsync("Front view captured successfully.");

                stabilityCountRef.current = 0;
                setStabilityProgress(0);
                isCapturingRef.current = false;
                setFitStep(FIT_STEPS.LEFT);
                fitStepRef.current = FIT_STEPS.LEFT;

                setLiveGuidance({
                  main: 'Now slowly turn your head to the left.',
                  sub: 'Turn ~45°–70° towards your left shoulder',
                  corrective: false
                });
                await speakVoiceAsync("Now slowly turn your head to the left.");
              }
            } else {
              stabilityCountRef.current = Math.max(0, stabilityCountRef.current - 1);
              setStabilityProgress(Math.round((stabilityCountRef.current / 12) * 100));
              setLiveGuidance({
                main: 'Please look straight at the camera.',
                sub: 'Level your head directly facing the screen',
                corrective: true
              });
            }
          }

          // STEP 2: LEFT PROFILE VIEW
          else if (currentFitStep === FIT_STEPS.LEFT) {
            if (smooth.yawDeg >= 16.0) {
              // Turned right instead of left
              stabilityCountRef.current = 0;
              setStabilityProgress(0);
              setLiveGuidance({
                main: 'Please turn to the LEFT, not right',
                sub: 'Turn your head towards your left shoulder',
                corrective: true
              });
              if (Date.now() - lastSpokenWrongTurnRef.current > 6000) {
                lastSpokenWrongTurnRef.current = Date.now();
                speakVoice("Please turn to the left.");
              }
            } else if (smooth.yawDeg <= -20.0 && smooth.yawDeg >= -85.0) {
              // Correct left turn
              stabilityCountRef.current += 1;
              const prog = Math.min(100, Math.round((stabilityCountRef.current / 12) * 100));
              setStabilityProgress(prog);
              setLiveGuidance({
                main: 'Hold steady...',
                sub: 'Left temple arm reach detected ✓',
                corrective: false
              });

              if (stabilityCountRef.current >= 12) {
                isCapturingRef.current = true;
                playCaptureChime();
                const blob = await captureCanvasBlobAsync();
                capturedBlobsRef.current.left = blob;

                setLiveGuidance({
                  main: 'Left profile captured.',
                  sub: 'Preparing for right profile...',
                  corrective: false
                });

                await speakVoiceAsync("Left profile captured successfully.");

                stabilityCountRef.current = 0;
                setStabilityProgress(0);
                isCapturingRef.current = false;
                setFitStep(FIT_STEPS.RIGHT);
                fitStepRef.current = FIT_STEPS.RIGHT;

                setLiveGuidance({
                  main: 'Now slowly turn your head to the right.',
                  sub: 'Turn ~45°–70° towards your right shoulder',
                  corrective: false
                });
                await speakVoiceAsync("Now slowly turn your head to the right.");
              }
            } else {
              stabilityCountRef.current = Math.max(0, stabilityCountRef.current - 1);
              setStabilityProgress(Math.round((stabilityCountRef.current / 12) * 100));
              setLiveGuidance({
                main: 'Now slowly turn your head to the left.',
                sub: 'Turn a bit further towards your left shoulder (~45°–70°)',
                corrective: false
              });
            }
          }

          // STEP 3: RIGHT PROFILE VIEW
          else if (currentFitStep === FIT_STEPS.RIGHT) {
            if (smooth.yawDeg <= -16.0) {
              // Turned left instead of right
              stabilityCountRef.current = 0;
              setStabilityProgress(0);
              setLiveGuidance({
                main: 'Please turn to the RIGHT, not left',
                sub: 'Turn your head towards your right shoulder',
                corrective: true
              });
              if (Date.now() - lastSpokenWrongTurnRef.current > 6000) {
                lastSpokenWrongTurnRef.current = Date.now();
                speakVoice("Please turn to the right.");
              }
            } else if (smooth.yawDeg >= 20.0 && smooth.yawDeg <= 85.0) {
              // Correct right turn
              stabilityCountRef.current += 1;
              const prog = Math.min(100, Math.round((stabilityCountRef.current / 12) * 100));
              setStabilityProgress(prog);
              setLiveGuidance({
                main: 'Hold steady...',
                sub: 'Right temple arm reach detected ✓',
                corrective: false
              });

              if (stabilityCountRef.current >= 12) {
                isCapturingRef.current = true;
                playCaptureChime();
                const blob = await captureCanvasBlobAsync();
                capturedBlobsRef.current.right = blob;

                setFitStep(FIT_STEPS.ANALYZING);
                fitStepRef.current = FIT_STEPS.ANALYZING;
                setIsAnalyzing(true);
                setLiveGuidance({
                  main: 'All three views captured!',
                  sub: 'Analyzing eyewear fit and stability...',
                  corrective: false
                });

                await speakVoiceAsync("All views captured. Analyzing eyewear fit.");

                isCapturingRef.current = false;
                submitFitAnalysis();
              }
            } else {
              stabilityCountRef.current = Math.max(0, stabilityCountRef.current - 1);
              setStabilityProgress(Math.round((stabilityCountRef.current / 12) * 100));
              setLiveGuidance({
                main: 'Now slowly turn your head to the right.',
                sub: 'Turn a bit further towards your right shoulder (~45°–70°)',
                corrective: false
              });
            }
          }
        }

      } else if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 1) {
        updateStatus("Multiple faces detected. Please keep only one face in view.");
      } else {
        if (lostTrackingCountRef.current < 8 && smoothPos.current.width > 0) {
          lostTrackingCountRef.current += 1;
        } else {
          updateStatus("Face not detected. Please keep your face inside the camera frame.");
        }
      }
      ctx.restore();
    });

    if (uploadedImage) {
      updateStatus("Processing photo...");
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        if (!engineRef.current.isActive) return;
        uploadedImageRef.current = img;
        canvasRef.current.width = img.width;
        canvasRef.current.height = img.height;
        await faceMesh.send({image: img});
      };
      img.src = uploadedImage;
    } else if (videoRef.current) {
      const isCameraActive = () => {
        const v = videoRef.current;
        if (!v) return false;
        if (v.srcObject && v.srcObject.active) {
          const tracks = v.srcObject.getVideoTracks();
          if (tracks.length > 0 && tracks[0].readyState === 'live') return true;
        }
        return v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
      };

      let camStarted = isCameraActive();
      if (camStarted) {
        updateStatus("");
      } else {
        updateStatus("Initializing camera...");
      }

      const cameraTimeout = setTimeout(() => {
        if (!engineRef.current.isActive) return;
        if (isCameraActive()) {
          camStarted = true;
          updateStatus("");
          return;
        }
        if (!camStarted) {
          updateStatus("Camera initialization timed out or access was denied. Please allow camera permissions or upload a photo below.");
        }
      }, 8000);

      const handleVideoActive = () => {
        camStarted = true;
        clearTimeout(cameraTimeout);
        updateStatus("");
      };

      const vEl = videoRef.current;
      vEl.addEventListener('playing', handleVideoActive);
      vEl.addEventListener('loadeddata', handleVideoActive);
      vEl.addEventListener('loadedmetadata', handleVideoActive);

      let isProcessingFrame = false;

      try {
        const CameraClass = window.Camera || Camera;
        if (!CameraClass) {
          clearTimeout(cameraTimeout);
          updateStatus("Camera module is loading. Please check your connection or upload a photo.");
          return;
        }

        const camera = new CameraClass(videoRef.current, {
          onFrame: async () => {
            if (!engineRef.current.isActive || !canvasRef.current || !videoRef.current) return;
            if (isProcessingFrame) return; // Drop frame if previous is still computing, prevents frame backlog & freezes!
            isProcessingFrame = true;

            if (!camStarted) {
              camStarted = true;
              clearTimeout(cameraTimeout);
              updateStatus("");
            }
            if (videoRef.current.videoWidth > 0 && canvasRef.current.width !== videoRef.current.videoWidth) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
            }
            try {
              await faceMesh.send({image: videoRef.current});
            } catch (meshErr) {
              // Frame dropped gracefully without freezing
            } finally {
              isProcessingFrame = false;
            }
          },
          facingMode: 'user',
          width: 1280,
          height: 720
        });
        engineRef.current.camera = camera;
        camera.start().catch((camErr) => {
          if (isCameraActive()) {
            camStarted = true;
            clearTimeout(cameraTimeout);
            return;
          }
          clearTimeout(cameraTimeout);
          console.error("Camera start failure:", camErr);
          if (camErr?.name === 'NotAllowedError' || camErr?.name === 'PermissionDeniedError') {
            updateStatus("Camera access was denied. Please allow camera permissions in your browser or upload a photo below.");
          } else {
            updateStatus("Camera access was denied or device is busy. Please close other camera apps or upload a photo.");
          }
        });
      } catch (camInitErr) {
        clearTimeout(cameraTimeout);
        console.error("Camera initialization error:", camInitErr);
        updateStatus("Camera setup error. You can upload a portrait photo below.");
      }

      return () => {
        engineRef.current.isActive = false;
        if (vEl) {
          vEl.removeEventListener('playing', handleVideoActive);
          vEl.removeEventListener('loadeddata', handleVideoActive);
          vEl.removeEventListener('loadedmetadata', handleVideoActive);
          if (vEl.srcObject) {
            try {
              const tracks = vEl.srcObject.getTracks();
              tracks.forEach(track => track.stop());
            } catch (e) {}
            vEl.srcObject = null;
          }
        }
        if (engineRef.current.camera) {
          try { engineRef.current.camera.stop(); } catch (e) {}
          engineRef.current.camera = null;
        }
        if (engineRef.current.faceMesh) {
          try { engineRef.current.faceMesh.close(); } catch (e) {}
          engineRef.current.faceMesh = null;
        }
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      };
    }

    return () => {
      engineRef.current.isActive = false;
      if (engineRef.current.camera) {
        try { engineRef.current.camera.stop(); } catch (e) {}
        engineRef.current.camera = null;
      }
      if (engineRef.current.faceMesh) {
        try { engineRef.current.faceMesh.close(); } catch (e) {}
        engineRef.current.faceMesh = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [uploadedImage]);

  // Launch Streamlined 3-Step Fit Analysis
  const startFitAnalysisWorkflow = () => {
    setIsFitAnalysisActive(true);
    setFitStep(FIT_STEPS.FRONT);
    fitStepRef.current = FIT_STEPS.FRONT;
    stabilityCountRef.current = 0;
    setStabilityProgress(0);
    setFitReport(null);
    setShowReportModal(false);
    capturedBlobsRef.current = { front: null, left: null, right: null };
    motionMetricsRef.current = { initialBridgeY: 0, maxDisplacementPx: 0, tiltDeltaDeg: 0 };
    setLiveGuidance({
      main: 'Please look straight at the camera.',
      sub: 'Align your face directly facing the screen',
      corrective: false
    });
    speakVoice("Please look straight at the camera.");
  };

  const cancelFitAnalysis = () => {
    setIsFitAnalysisActive(false);
    setFitStep(FIT_STEPS.IDLE);
    fitStepRef.current = FIT_STEPS.IDLE;
    stabilityCountRef.current = 0;
    setStabilityProgress(0);
    setIsAnalyzing(false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const submitFitAnalysis = async () => {
    try {
      setIsAnalyzing(true);
      const formData = new FormData();
      
      const blobs = capturedBlobsRef.current;
      if (blobs.front) formData.append("front_image", blobs.front, "front.jpg");
      if (blobs.left) formData.append("left_image", blobs.left, "left.jpg");
      if (blobs.right) formData.append("right_image", blobs.right, "right.jpg");

      const framePayload = {
        id: activeFrame?.id,
        name: activeFrame?.name,
        category: activeFrame?.category,
        color: activeFrame?.color,
        width_mm: activeFrame?.width_mm || activeFrame?.frame_width_mm || null,
        frame_width_mm: activeFrame?.frame_width_mm || activeFrame?.width_mm || null,
        lens_width_mm: activeFrame?.lens_width_mm || null,
        lens_height_mm: activeFrame?.lens_height_mm || null,
        bridge_width_mm: activeFrame?.bridge_width_mm || null,
        temple_length_mm: activeFrame?.temple_length_mm || null
      };

      formData.append("frame_json", JSON.stringify(framePayload));
      if (userIpdMm) formData.append("user_ipd_mm", userIpdMm.toString());
      if (calibratedMmPerPx) formData.append("calibrated_mm_per_px", calibratedMmPerPx.toString());
      formData.append("motion_displacement_px", (motionMetricsRef.current.maxDisplacementPx || 0).toFixed(1));
      formData.append("tilt_change_deg", (motionMetricsRef.current.tiltDeltaDeg || 0).toFixed(1));

      const res = await axios.post(`${apiBase}/api/analyze/fit-stability`, formData);
      setFitReport(res.data);
      setShowReportModal(true);
      if (onSaveFitResult) {
        onSaveFitResult(res.data, activeFrame);
      }
    } catch (err) {
      console.error("Fit stability analysis API failed:", err);
      alert("Unable to complete fit analysis. Please try again.");
    } finally {
      setIsAnalyzing(false);
      setFitStep(FIT_STEPS.COMPLETED);
    }
  };

  const handleCapture = () => {
    if (canvasRef.current) {
      setCapturedImage(canvasRef.current.toDataURL('image/jpeg', 0.9));
    }
  };
  
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadedImage(URL.createObjectURL(file));
      setCapturedImage(null); 
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
      backgroundColor: 'rgba(255,255,255,0.98)', zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Top Header */}
      <div style={{padding: '0.85rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff'}}>
        <div>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <h2 style={{margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#0f172a'}}>Virtual Try-On & Real-Time Eyewear Fit Analysis</h2>
            <span style={{fontSize: '0.75rem', background: '#e0f2fe', color: '#0284c7', padding: '2px 8px', borderRadius: '12px', fontWeight: 600}}>
              3D Anatomical Engine
            </span>
          </div>
          <p style={{margin: '0.2rem 0 0 0', color: '#64748b', fontSize: '0.85rem'}}>
            Front frame aligns with eyes & bridge. Left and right temple arms extend naturally from hinges along head sides to your ears.
          </p>
        </div>
        
        <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
          <label style={{
            padding: '0.55rem 1.15rem', 
            background: '#f8fafc', 
            color: '#0f172a', 
            border: '1px solid #cbd5e1', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontSize: '0.88rem', 
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            transition: 'all 0.2s ease'
          }}>
            <span>📷</span> Upload Photo
            <input type="file" accept="image/*" style={{display: 'none'}} onChange={handleFileUpload} />
          </label>

          {uploadedImage && (
            <button 
              type="button"
              onClick={() => { setUploadedImage(null); setCapturedImage(null); uploadedImageRef.current = null; }} 
              style={{
                padding: '0.55rem 1.15rem', 
                background: '#f1f5f9', 
                color: '#334155', 
                border: '1px solid #cbd5e1', 
                borderRadius: '6px', 
                cursor: 'pointer', 
                fontSize: '0.88rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>📹</span> Use Camera
            </button>
          )}

          <button 
            type="button"
            onClick={onClose} 
            style={{
              padding: '0.55rem 1.25rem', 
              background: '#0f172a', 
              color: '#ffffff', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer', 
              fontSize: '0.88rem', 
              fontWeight: 600,
              boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Embedded Responsive Stylesheet */}
      <style>{`
        .vto-container * {
          box-sizing: border-box;
        }
        .vto-scroll-container::-webkit-scrollbar {
          height: 8px;
          width: 8px;
        }
        .vto-scroll-container::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .vto-scroll-container::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        @media (max-width: 768px) {
          .vto-camera-box {
            min-height: 340px !important;
            max-height: 52vh !important;
            border-radius: 12px !important;
          }
          .vto-detail-bar {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 0.75rem !important;
          }
          .vto-header-bar {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 0.6rem !important;
          }
        }
      `}</style>

      {/* Main Viewport Container */}
      <div 
        className="vto-scroll-container"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: '1rem 1.25rem 2rem',
          gap: '1rem',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: '#f8fafc',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        
        {/* Camera / Canvas Display Box - Large, prominent, non-obstructed preview */}
        {!capturedImage ? (
          <div 
            className="vto-camera-box"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '960px',
              minHeight: '440px',
              maxHeight: 'min(70vh, 640px)',
              background: '#090d16',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 14px 34px -4px rgba(15, 23, 42, 0.28)',
              border: '1px solid #cbd5e1',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            {!uploadedImage && (
              <video 
                ref={videoRef} 
                style={{display: 'none'}} 
                playsInline 
                muted 
                autoPlay
              />
            )}
            <canvas 
              ref={canvasRef} 
              style={{
                width: '100%',
                height: '100%',
                maxHeight: 'min(70vh, 640px)',
                objectFit: 'contain',
                display: 'block',
                transform: uploadedImage ? 'none' : 'scaleX(-1)'
              }}
            />
            
            {/* Status Pill (When initializing, warnings or error) */}
            {status && !isFitAnalysisActive && (
              <div style={{
                position: 'absolute',
                top: 14,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(15, 23, 42, 0.88)',
                backdropFilter: 'blur(6px)',
                color: '#fff',
                padding: '0.45rem 1.15rem',
                borderRadius: '20px',
                fontSize: '0.85rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                zIndex: 12,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.15)'
              }}>
                {status}
              </div>
            )}

            {/* REAL-TIME LIVE FIT STATUS BADGE (Top Right of Viewport - Non-obstructive) */}
            <div style={{
              position: 'absolute',
              top: 14,
              right: 14,
              zIndex: 11,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: liveFitBadge.bg,
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.86rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              backdropFilter: 'blur(6px)',
              letterSpacing: '0.02em',
              transition: 'all 0.3s ease',
              pointerEvents: 'auto',
              cursor: 'default',
              border: '1px solid rgba(255,255,255,0.2)'
            }} title={liveFitBadge.detail}>
              <span style={{ fontSize: '0.9rem' }}>{liveFitBadge.icon}</span>
              <span>{liveFitBadge.label}</span>
            </div>

            {/* LIVE TRY-ON DIAGNOSTIC TELEMETRY HUD (Repositioned to Top-Left Corner to NEVER cover user's face) */}
            {showTryOnHud && !uploadedImage && !isFitAnalysisActive && (
              <div style={{
                position: 'absolute',
                top: 14,
                left: 14,
                zIndex: 11,
                background: 'rgba(15, 23, 42, 0.84)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: '#ffffff',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.70rem',
                minWidth: '150px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
                pointerEvents: 'none'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: '3px' }}>
                  <span style={{ color: '#38bdf8', fontWeight: 700 }}>🔍 TRY-ON HUD</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>LIVE</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span style={{ color: '#94a3b8' }}>Pose:</span>
                  <span style={{ fontWeight: 700, color: '#f8fafc' }}>{tryOnTelemetry.pose}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span style={{ color: '#94a3b8' }}>Yaw:</span>
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>{tryOnTelemetry.yaw > 0 ? `+${tryOnTelemetry.yaw}°` : `${tryOnTelemetry.yaw}°`}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span style={{ color: '#94a3b8' }}>Pitch / Roll:</span>
                  <span style={{ color: '#cbd5e1' }}>{tryOnTelemetry.pitch}° / {tryOnTelemetry.roll}°</span>
                </div>
                {userIpdMm && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: '#94a3b8' }}>Binocular IPD:</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>{userIpdMm} mm</span>
                  </div>
                )}
                {estimatedTempleLengthMm && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Temple Reach:</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>~{estimatedTempleLengthMm} mm</span>
                  </div>
                )}
              </div>
            )}

            {/* Fit Analysis Interactive HUD (Only during 3-Step Analysis) */}
            {isFitAnalysisActive && (
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                padding: '1.25rem', boxSizing: 'border-box', zIndex: 11
              }}>
                {/* 3-Step Indicator Badges (Top Center) */}
                <div style={{display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap'}}>
                  {[
                    { id: FIT_STEPS.FRONT, label: '1. Front View' },
                    { id: FIT_STEPS.LEFT, label: '2. Left Profile' },
                    { id: FIT_STEPS.RIGHT, label: '3. Right Profile' }
                  ].map((s) => {
                    const isActive = fitStep === s.id;
                    const isDone = (
                      (fitStep === FIT_STEPS.LEFT && s.id === FIT_STEPS.FRONT) ||
                      (fitStep === FIT_STEPS.RIGHT && [FIT_STEPS.FRONT, FIT_STEPS.LEFT].includes(s.id)) ||
                      (fitStep === FIT_STEPS.COMPLETED || fitStep === FIT_STEPS.ANALYZING)
                    );

                    return (
                      <span 
                        key={s.id} 
                        style={{
                          fontSize: '0.78rem', fontWeight: 600, padding: '5px 12px', borderRadius: '20px',
                          background: isActive ? '#0284c7' : isDone ? '#10b981' : 'rgba(15, 23, 42, 0.75)',
                          color: '#ffffff', backdropFilter: 'blur(4px)', 
                          border: isActive ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                          boxShadow: isActive ? '0 0 10px rgba(56, 189, 248, 0.4)' : 'none',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {isDone ? '✓ ' : ''}{s.label}
                      </span>
                    );
                  })}
                </div>

                {/* Live Instruction Banner at Bottom */}
                <div style={{
                  background: liveGuidance.corrective ? 'rgba(239, 68, 68, 0.92)' : 'rgba(15, 23, 42, 0.88)',
                  backdropFilter: 'blur(8px)', borderRadius: '10px', padding: '0.85rem 1.25rem',
                  color: '#ffffff', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  transition: 'background 0.25s ease'
                }}>
                  <div style={{fontSize: '1.05rem', fontWeight: 700, marginBottom: '2px'}}>
                    {liveGuidance.main || 'Fit Analysis in progress...'}
                  </div>
                  <div style={{fontSize: '0.82rem', color: liveGuidance.corrective ? '#fee2e2' : '#94a3b8'}}>
                    {liveGuidance.sub}
                  </div>

                  {/* Stability Progress Bar */}
                  {stabilityProgress > 0 && (
                    <div style={{width: '100%', height: '6px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', marginTop: '8px', overflow: 'hidden'}}>
                      <div style={{width: `${stabilityProgress}%`, height: '100%', background: '#38bdf8', transition: 'width 0.15s ease'}}></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Hidden image for canvas drawing - ONLY authentic photos, never cartoon SVG fallback */}
            {(() => {
              const rawImg = activeFrame?.image || activeFrame?.front_image || activeFrame?.img_url || '';
              const resolvedSrc = (rawImg.startsWith('http') || rawImg.startsWith('/uploads') || rawImg.startsWith('/frames')) 
                ? rawImg 
                : (rawImg ? (apiBase + rawImg) : '');
              return (
                <img 
                  ref={frameImgRef} 
                  src={resolvedSrc} 
                  crossOrigin="anonymous" 
                  style={{display: 'none'}} 
                  alt="" 
                  onLoad={() => {
                    if (uploadedImage && uploadedImageRef.current && engineRef.current?.faceMesh) {
                      engineRef.current.faceMesh.send({ image: uploadedImageRef.current }).catch(() => {});
                    }
                  }}
                  onError={() => {
                    handleImageError(activeFrame?.id, activeFrame?.name, resolvedSrc);
                  }}
                />
              );
            })()}
          </div>
        ) : (
          <div style={{width: '100%', maxWidth: '960px', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 12px 32px -4px rgba(0,0,0,0.25)', border: '1px solid #cbd5e1'}}>
            <img src={capturedImage} style={{width: '100%', display: 'block', transform: uploadedImage ? 'none' : 'scaleX(-1)'}} alt="Captured look" />
          </div>
        )}

        {/* Visual Simulation & Geometry Approximation Disclosure */}
        <div style={{
          width: '100%', maxWidth: '960px',
          background: '#ffffff', border: '1px solid #e2e8f0',
          borderRadius: '10px', padding: '0.65rem 1rem',
          fontSize: '0.76rem', color: '#475569', lineHeight: 1.45,
          display: 'flex', alignItems: 'center', gap: '0.65rem',
          boxSizing: 'border-box',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
        }}>
          <span style={{fontSize: '1rem', flexShrink: 0}}>ℹ️</span>
          <span>
            <strong>3D Anatomical Simulation:</strong> Frame chassis aligns to nasal bridge and eyes with live perspective tracking. Temple arms extend from hinges to Otobasion Superius (ear crest). Physical contact force and skin comfort require hands-on fitting.
          </span>
        </div>

        {/* Selected Frame Detail & Quick Navigation Bar (Outside camera preview) */}
        <div 
          className="vto-detail-bar"
          style={{
            background: '#ffffff',
            padding: '0.9rem 1.25rem',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '960px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            boxSizing: 'border-box'
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'}}>
            {/* Quick Prev / Next navigation arrows */}
            {genuineFrames.length > 1 && (
              <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                <button
                  type="button"
                  onClick={handlePrevFrame}
                  title="Previous frame (Left Arrow)"
                  aria-label="Previous Frame"
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#334155',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                >
                  ‹
                </button>
                <span style={{fontSize: '0.78rem', fontWeight: 600, color: '#64748b', padding: '0 4px', whiteSpace: 'nowrap'}}>
                  {currentFrameIndex >= 0 ? currentFrameIndex + 1 : 1} / {genuineFrames.length}
                </span>
                <button
                  type="button"
                  onClick={handleNextFrame}
                  title="Next frame (Right Arrow)"
                  aria-label="Next Frame"
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#334155',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                >
                  ›
                </button>
              </div>
            )}

            {/* Active frame small studio thumbnail */}
            {activeFrame && (
              <img 
                src={(() => {
                  const raw = activeFrame.image || activeFrame.front_image || '';
                  return (raw.startsWith('http') || raw.startsWith('/uploads') || raw.startsWith('/frames')) ? raw : (apiBase + raw);
                })()}
                alt={activeFrame.name}
                style={{height: '36px', maxWidth: '75px', objectFit: 'contain'}}
                onError={() => handleImageError(activeFrame.id, activeFrame.name, activeFrame.image)}
              />
            )}

            {/* Frame metadata & specs */}
            <div>
              <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                <h3 style={{margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a'}}>
                  {activeFrame?.name || 'Studio Optical Frame'}
                </h3>
                {unverifiedImages[activeFrame?.id] && (
                  <span style={{fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '4px', fontWeight: 600}}>
                    ⚠️ Photo Under Review
                  </span>
                )}
              </div>
              <div style={{display: 'flex', gap: '0.85rem', fontSize: '0.82rem', flexWrap: 'wrap', marginTop: '0.2rem'}}>
                <span style={{color: '#0284c7', fontWeight: 600}}>Style Match: {activeFrame?.final_score?.toFixed(0) || 85}%</span>
                {activeFrame?.category && <span style={{color: '#475569', textTransform: 'capitalize'}}>Shape: {activeFrame.category}</span>}
                {activeFrame?.width_mm && <span style={{color: '#64748b'}}>Width: {activeFrame.width_mm} mm</span>}
                {activeFrame?.bridge_width_mm && <span style={{color: '#64748b'}}>Bridge: {activeFrame.bridge_width_mm} mm</span>}
                {activeFrame?.temple_length_mm && <span style={{color: '#64748b'}}>Temple: {activeFrame.temple_length_mm} mm</span>}
              </div>
            </div>
          </div>

          <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap'}}>
            {fitReport && (
              <button 
                onClick={() => setShowReportModal(true)} 
                style={{padding: '0.6rem 1.1rem', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'}}
              >
                📊 View Report
              </button>
            )}
            {!capturedImage ? (
              <button onClick={handleCapture} style={{padding: '0.6rem 1.1rem', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'}}>
                Capture Look
              </button>
            ) : (
              <button onClick={() => setCapturedImage(null)} style={{padding: '0.6rem 1.1rem', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'}}>
                Retake
              </button>
            )}
          </div>
        </div>
        
        {/* Genuine Optical Frame Selection Carousel (Cleanly below camera preview) */}
        <div style={{width: '100%', maxWidth: '960px', boxSizing: 'border-box'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '6px'}}>
            <p style={{fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', margin: 0}}>
              Authentic Studio Frame Collection ({genuineFrames.length} Available):
            </p>
            <span style={{fontSize: '0.75rem', color: '#64748b'}}>
              Click any frame to switch • Use Left / Right arrow keys
            </span>
          </div>

          <div 
            className="vto-scroll-container"
            style={{
              display: 'flex',
              gap: '0.85rem',
              overflowX: 'auto',
              paddingBottom: '0.65rem',
              width: '100%'
            }}
          >
            {genuineFrames.map((r, idx) => {
              const isSelected = activeFrame?.id === r.id;
              const hasErr = unverifiedImages[r.id];
              const rawImg = r.image || r.front_image || '';
              const resolvedCardSrc = (rawImg.startsWith('http') || rawImg.startsWith('/uploads') || rawImg.startsWith('/frames')) 
                ? rawImg 
                : (rawImg ? (apiBase + rawImg) : '');

              return (
                <div 
                  key={r.id || idx} 
                  onClick={() => { setActiveFrame(r); setFitReport(null); }}
                  style={{
                    minWidth: '135px',
                    maxWidth: '145px',
                    border: isSelected ? '2px solid #0284c7' : '1px solid #cbd5e1', 
                    borderRadius: '10px',
                    padding: '0.6rem 0.5rem',
                    cursor: 'pointer',
                    background: isSelected ? '#f0f9ff' : '#ffffff',
                    textAlign: 'center',
                    boxShadow: isSelected ? '0 0 0 1px #0284c7, 0 4px 10px rgba(2, 132, 199, 0.18)' : '0 1px 3px rgba(0,0,0,0.05)',
                    transition: 'all 0.18s ease',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  {/* Studio photograph */}
                  {!hasErr ? (
                    <img 
                      src={resolvedCardSrc} 
                      style={{
                        width: '100%',
                        height: '48px',
                        objectFit: 'contain',
                        filter: isSelected ? 'drop-shadow(0 2px 4px rgba(2, 132, 199, 0.3))' : 'none'
                      }} 
                      alt={r.name} 
                      onError={() => handleImageError(r.id, r.name, resolvedCardSrc)}
                    />
                  ) : (
                    <div style={{
                      height: '48px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.68rem',
                      color: '#92400e',
                      background: '#fef3c7',
                      borderRadius: '4px',
                      padding: '2px 4px'
                    }}>
                      Photo in review
                    </div>
                  )}

                  {/* Frame Name */}
                  <div style={{
                    fontSize: '0.76rem',
                    marginTop: '0.4rem',
                    fontWeight: 700,
                    color: isSelected ? '#0284c7' : '#0f172a',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }} title={r.name}>
                    {r.name}
                  </div>

                  {/* Shape & Match Score */}
                  <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', marginTop: '2px'}}>
                    <span style={{fontSize: '0.70rem', color: '#0284c7', fontWeight: 600}}>
                      {r.final_score ? `${r.final_score.toFixed(0)}%` : '85%'} Match
                    </span>
                    {r.category && (
                      <span style={{fontSize: '0.68rem', color: '#64748b', textTransform: 'capitalize'}}>
                        • {r.category}
                      </span>
                    )}
                  </div>

                  {/* Dimensions */}
                  <div style={{fontSize: '0.66rem', color: '#94a3b8', marginTop: '2px'}}>
                    {r.width_mm || r.frame_width_mm ? `${r.width_mm || r.frame_width_mm}mm` : ''} 
                    {r.temple_length_mm ? ` | ${r.temple_length_mm}mm` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Eyewear Fit & Stability Analysis Report Modal */}
      {showReportModal && fitReport && (
        <FitStabilityReport
          report={fitReport}
          frame={activeFrame}
          onRetake={() => {
            setShowReportModal(false);
            startFitAnalysisWorkflow();
          }}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
}
