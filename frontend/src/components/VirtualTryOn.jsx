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
  
  const [activeFrame, setActiveFrame] = useState(frame);
  const [status, setStatus] = useState("Initializing...");
  const [capturedImage, setCapturedImage] = useState(null);
  const [uploadedImage, setUploadedImage] = useState(null);

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

  // Update live fit badge whenever frame changes
  useEffect(() => {
    const badge = evaluateLiveFit(activeFrame, userIpdMm, faceWidthMm, estimatedTempleLengthMm);
    setLiveFitBadge(badge);
  }, [activeFrame, userIpdMm, faceWidthMm, estimatedTempleLengthMm]);

  // Frame navigation indices
  const currentFrameIndex = allRecommendations.findIndex(r => r.id === activeFrame?.id);

  const handlePrevFrame = useCallback(() => {
    if (!allRecommendations || allRecommendations.length <= 1) return;
    const prevIdx = (currentFrameIndex - 1 + allRecommendations.length) % allRecommendations.length;
    setActiveFrame(allRecommendations[prevIdx]);
    setFitReport(null);
  }, [currentFrameIndex, allRecommendations]);

  const handleNextFrame = useCallback(() => {
    if (!allRecommendations || allRecommendations.length <= 1) return;
    const nextIdx = (currentFrameIndex + 1) % allRecommendations.length;
    setActiveFrame(allRecommendations[nextIdx]);
    setFitReport(null);
  }, [currentFrameIndex, allRecommendations]);

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
  useEffect(() => {
    smoothPos.current = { 
      x: 0, y: 0, width: 0, angle: 0, 
      yawDeg: 0, pitchDeg: 0, rollDeg: 0,
      earApexRx: 0, earApexRy: 0, earDropRx: 0, earDropRy: 0,
      earApexLx: 0, earApexLy: 0, earDropLx: 0, earDropLy: 0
    };
  }, [activeFrame]);

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
        if (status) setStatus("");
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

        const helixRootR = landmarks[127] || landmarks[234]; // Anatomical Right superior preauricular
        const helixRootL = landmarks[356] || landmarks[454]; // Anatomical Left superior preauricular

        const faceHeight = Math.hypot((chin.x - forehead.x) * w, (chin.y - forehead.y) * h);
        const faceWidth = Math.hypot((tragusL.x - tragusR.x) * w, (tragusL.y - tragusR.y) * h);

        // Otobasion Superius (Ear Apex attachment at superior root of pinna)
        // Directly maps to anatomical ear crest at landmark 127 (Right Ear) and landmark 356 (Left Ear)
        const targetApexRx = helixRootR.x * w;
        const targetApexRy = helixRootR.y * h;
        const targetDropRx = targetApexRx - (faceHeight * 0.035);
        const targetDropRy = targetApexRy + (faceHeight * 0.085);

        const targetApexLx = helixRootL.x * w;
        const targetApexLy = helixRootL.y * h;
        const targetDropLx = targetApexLx + (faceHeight * 0.035);
        const targetDropLy = targetApexLy + (faceHeight * 0.085);

        // Head roll angle:
        // Interocular line (between eye pupils / corners) directly defines the true optical horizontal tilt.
        const dx = (pupilL.x - pupilR.x) * w; 
        const dy = (pupilL.y - pupilR.y) * h;
        const eyeRollRad = Math.atan2(dy, dx);
        
        // Glasses roll angle follows the optical interocular tilt, clamped defensively to +-35 deg
        let rollAngleRad = Math.max(-0.61, Math.min(0.61, eyeRollRad));
        const ipdPx = Math.hypot(dx, dy);

        // Robust physical frame width scaling:
        // Anchors to continuous, unoccluded eye geometry (outer eye corners + pupils)
        // Standard adult eye corner span (landmark 33 to 263) is ~96mm; IPD is ~63mm.
        const eyeSpanPx = Math.hypot((eyeCornerL.x - eyeCornerR.x) * w, (eyeCornerL.y - eyeCornerR.y) * h);
        const pupilSpanPx = Math.hypot((pupilL.x - pupilR.x) * w, (pupilL.y - pupilR.y) * h);
        const pxPerMm = 0.55 * (eyeSpanPx / 96.0) + 0.45 * (pupilSpanPx / 63.0);
        
        const frameWidthMm = activeFrame?.frame_width_mm || activeFrame?.width_mm || 136.0;
        const targetWidth = frameWidthMm * pxPerMm;

        // Eyewear placement:
        // Anchors bridge saddle point directly to nasal bridge landmark 168 at eye level
        const targetX = bridgeX * 0.75 + pupilsMidX * 0.25;
        const targetY = bridgeY * 0.60 + pupilsMidY * 0.40;
        
        // Dynamic smoothing (0.50 historical + 0.50 current for responsive, jitter-free tracking)
        // If angle changes rapidly (e.g. initial face lock), reduce smoothing to avoid lag
        const isAngleJump = Math.abs(rollAngleRad - smoothPos.current.angle) > 0.25;
        const s = uploadedImage || isAngleJump ? 0.0 : 0.50; 
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
          // Continuous, jitter-free smoothing for stable frame fit
          smooth.x = smooth.x * 0.60 + targetX * 0.40;
          smooth.y = smooth.y * 0.60 + targetY * 0.40;
          smooth.width = smooth.width * 0.70 + targetWidth * 0.30;
          smooth.angle = smooth.angle * 0.60 + rollAngleRad * 0.40;
          smooth.yawDeg = smooth.yawDeg * 0.60 + rawYawDeg * 0.40;
          smooth.pitchDeg = smooth.pitchDeg * 0.60 + rawPitchDeg * 0.40;
          smooth.rollDeg = smooth.rollDeg * 0.60 + rawRollDeg * 0.40;
          smooth.earApexRx = smooth.earApexRx * 0.60 + targetApexRx * 0.40;
          smooth.earApexRy = smooth.earApexRy * 0.60 + targetApexRy * 0.40;
          smooth.earDropRx = smooth.earDropRx * 0.60 + targetDropRx * 0.40;
          smooth.earDropRy = smooth.earDropRy * 0.60 + targetDropRy * 0.40;
          smooth.earApexLx = smooth.earApexLx * 0.60 + targetApexLx * 0.40;
          smooth.earApexLy = smooth.earApexLy * 0.60 + targetApexLy * 0.40;
          smooth.earDropLx = smooth.earDropLx * 0.60 + targetDropLx * 0.40;
          smooth.earDropLy = smooth.earDropLy * 0.60 + targetDropLy * 0.40;
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
          const sliceDy = -drawH * 0.24;
          
          let hinges = { 
            rightX: -drawW / 2, 
            rightY: sliceDy + drawH * 0.25, 
            leftX: drawW / 2, 
            leftY: sliceDy + drawH * 0.25 
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
            const sDy = -projH * 0.24;
            
            const srcX = i * sliceW;
            
            drawCommands[i] = {
              img, srcX, srcY: 0, sw: sliceW, sh: img.naturalHeight,
              dx: projX - projW / 2, dy: sDy, dw: projW * 1.05, dh: projH
            };
            
            if (i === 0) {
              hinges.rightX = projX - projW / 2;
              hinges.rightY = sDy + projH * 0.25;
            }
            if (i === slices - 1) {
              hinges.leftX = projX + projW / 2;
              hinges.leftY = sDy + projH * 0.25;
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
            const cpX = startX + (apexX - startX) * 0.44;
            const cpY = startY + (apexY - startY) * 0.20 - (isCatEye ? 4 : 2);

            // 1. Ambient drop shadow
            ctx.lineWidth = baseArmThickness + 2.0;
            ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
            ctx.beginPath();
            ctx.moveTo(startX, startY + 1.5);
            ctx.quadraticCurveTo(cpX, cpY + 1.5, apexX, apexY + 1.5);
            ctx.lineTo(dropX, dropY + 1.5);
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
            ctx.lineTo(dropX, dropY);
            ctx.stroke();

            // 3. Specular highlight line
            ctx.lineWidth = Math.max(1.0, baseArmThickness * 0.24);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
            ctx.beginPath();
            ctx.moveTo(startX, startY - baseArmThickness * 0.18);
            ctx.quadraticCurveTo(cpX, cpY - baseArmThickness * 0.18, apexX, apexY - baseArmThickness * 0.18);
            ctx.stroke();

            // 4. Acetate Ear Sock for Wire / Aviator frames
            if (isWireFrame) {
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
            ctx.arc(startX, startY, Math.min(1.8, baseArmThickness * 0.30), 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          };

          // CONTINUOUS PERSPECTIVE & CRANIAL OCCLUSION:
          let rightArmAlpha = 1.0;
          let leftArmAlpha = 1.0;

          if (smooth.yawDeg > 12.0) {
            leftArmAlpha = 1.0;
            rightArmAlpha = Math.max(0, 1.0 - (smooth.yawDeg - 12.0) / 25.0);
          } else if (smooth.yawDeg < -12.0) {
            rightArmAlpha = 1.0;
            leftArmAlpha = Math.max(0, 1.0 - (Math.abs(smooth.yawDeg) - 12.0) / 25.0);
          } else {
            rightArmAlpha = 1.0;
            leftArmAlpha = 1.0;
          }

          ctx.save();
          ctx.translate(nX, nY);
          ctx.rotate(smooth.angle);

          // DRAW TEMPLE ARMS FIRST (Extending from frame hinges and fixing into user's ears)
          renderTempleArm(hinges.rightX, hinges.rightY, localApexRx, localApexRy, localDropRx, localDropRy, rightArmAlpha);
          renderTempleArm(hinges.leftX, hinges.leftY, localApexLx, localApexLy, localDropLx, localDropLy, leftArmAlpha);

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

          for (let idx of sliceIndices) {
            const cmd = drawCommands[idx];
            offCtx.drawImage(
              cmd.img, cmd.srcX, cmd.srcY, cmd.sw, cmd.sh, 
              offCenterX + cmd.dx, offCenterY + cmd.dy, cmd.dw, cmd.dh
            );
          }

          // Complete punchout of lens apertures to eliminate photographed folded arms & show clear eyes
          if (absYawDeg < 45.0) {
            offCtx.save();
            offCtx.globalCompositeOperation = 'destination-out';
            
            const lensRadiusX = drawW * 0.185;
            const lensRadiusY = drawH * 0.26;
            const lensCenterOffsetX = drawW * 0.255;
            const lensCenterOffsetY = offCenterY + sliceDy + drawH * 0.40;

            // Right Lens Aperture
            offCtx.beginPath();
            offCtx.ellipse(
              offCenterX - lensCenterOffsetX, lensCenterOffsetY, 
              lensRadiusX, lensRadiusY, isCatEye ? -0.10 : 0, 0, Math.PI * 2
            );
            offCtx.fill();

            // Left Lens Aperture
            offCtx.beginPath();
            offCtx.ellipse(
              offCenterX + lensCenterOffsetX, lensCenterOffsetY, 
              lensRadiusX, lensRadiusY, isCatEye ? 0.10 : 0, 0, Math.PI * 2
            );
            offCtx.fill();
            offCtx.restore();

            // Anti-reflective optical sheen
            offCtx.save();
            offCtx.globalCompositeOperation = 'source-over';
            
            const arGradR = offCtx.createLinearGradient(
              offCenterX - lensCenterOffsetX - lensRadiusX, lensCenterOffsetY - lensRadiusY,
              offCenterX - lensCenterOffsetX + lensRadiusX, lensCenterOffsetY + lensRadiusY
            );
            arGradR.addColorStop(0, "rgba(255, 255, 255, 0.09)");
            arGradR.addColorStop(0.35, "rgba(56, 189, 248, 0.03)");
            arGradR.addColorStop(1, "rgba(255, 255, 255, 0.01)");
            offCtx.fillStyle = arGradR;
            offCtx.beginPath();
            offCtx.ellipse(
              offCenterX - lensCenterOffsetX, lensCenterOffsetY, 
              lensRadiusX, lensRadiusY, isCatEye ? -0.10 : 0, 0, Math.PI * 2
            );
            offCtx.fill();

            const arGradL = offCtx.createLinearGradient(
              offCenterX + lensCenterOffsetX - lensRadiusX, lensCenterOffsetY - lensRadiusY,
              offCenterX + lensCenterOffsetX + lensRadiusX, lensCenterOffsetY + lensRadiusY
            );
            arGradL.addColorStop(0, "rgba(255, 255, 255, 0.09)");
            arGradL.addColorStop(0.35, "rgba(56, 189, 248, 0.03)");
            arGradL.addColorStop(1, "rgba(255, 255, 255, 0.01)");
            offCtx.fillStyle = arGradL;
            offCtx.beginPath();
            offCtx.ellipse(
              offCenterX + lensCenterOffsetX, lensCenterOffsetY, 
              lensRadiusX, lensRadiusY, isCatEye ? 0.10 : 0, 0, Math.PI * 2
            );
            offCtx.fill();
            offCtx.restore();
          }

          // Render pristine front frame chassis onto the main canvas
          ctx.drawImage(offCanvas, -offCenterX, -offCenterY);

          ctx.restore();
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
        setStatus("Multiple faces detected. Please keep only one face in view.");
      } else {
        setStatus("Face not detected. Please keep your face inside the camera frame.");
      }
      ctx.restore();
    });

    if (uploadedImage) {
      setStatus("Processing image...");
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        if (!engineRef.current.isActive) return;
        canvasRef.current.width = img.width;
        canvasRef.current.height = img.height;
        await faceMesh.send({image: img});
      };
      img.src = uploadedImage;
    } else if (videoRef.current) {
      setStatus("Initializing camera...");
      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (!engineRef.current.isActive || !canvasRef.current || !videoRef.current) return;
          if (canvasRef.current.width !== videoRef.current.videoWidth) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
          }
          await faceMesh.send({image: videoRef.current});
        },
        facingMode: 'user',
        width: 640,
        height: 480
      });
      engineRef.current.camera = camera;
      camera.start();
    }

    return () => {
      engineRef.current.isActive = false;
      if (engineRef.current.camera) engineRef.current.camera.stop();
      if (engineRef.current.faceMesh) engineRef.current.faceMesh.close();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [uploadedImage, activeFrame, isFitAnalysisActive]);

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
          {!isFitAnalysisActive ? (
            <button 
              onClick={startFitAnalysisWorkflow}
              style={{
                padding: '0.55rem 1.1rem', background: '#0284c7', color: '#fff', 
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.88rem',
                fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px',
                boxShadow: '0 2px 4px rgba(2, 132, 199, 0.2)'
              }}
            >
              <span>🔬</span> Start 3-Step Fit Analysis
            </button>
          ) : (
            <button 
              onClick={cancelFitAnalysis}
              style={{
                padding: '0.55rem 1.1rem', background: '#f1f5f9', color: '#475569', 
                border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '0.88rem',
                fontWeight: 600
              }}
            >
              Cancel Analysis
            </button>
          )}

          <label style={{padding: '0.55rem 1rem', background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500}}>
            Upload Photo
            <input type="file" accept="image/*" style={{display: 'none'}} onChange={handleFileUpload} />
          </label>

          {uploadedImage && (
            <button onClick={() => { setUploadedImage(null); setCapturedImage(null); }} style={{padding: '0.55rem 1rem', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem'}}>
              Use Camera
            </button>
          )}

          <button onClick={onClose} style={{padding: '0.55rem 1.1rem', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600}}>
            Close
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem', gap: '0.85rem', overflowY: 'auto', background: '#f8fafc'}}>
        
        {/* Camera / Canvas Display Box */}
        {!capturedImage ? (
          <div style={{position: 'relative', width: '100%', maxWidth: '680px', background: '#0f172a', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)'}}>
            {!uploadedImage && <video ref={videoRef} style={{display: 'none'}} playsInline muted autoPlay></video>}
            <canvas ref={canvasRef} style={{width: '100%', display: 'block', transform: uploadedImage ? 'none' : 'scaleX(-1)'}}></canvas>
            
            {/* Status Pill (When initializing or error) */}
            {status && !isFitAnalysisActive && (
              <div style={{position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(4px)', color: '#fff', padding: '0.4rem 1rem', borderRadius: '20px', fontSize: '0.85rem', whiteSpace: 'nowrap'}}>
                {status}
              </div>
            )}

            {/* REAL-TIME LIVE FIT STATUS BADGE (Top Right of Viewport - Reference Screenshot 3) */}
            <div style={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: liveFitBadge.bg,
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.88rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              backdropFilter: 'blur(4px)',
              letterSpacing: '0.02em',
              transition: 'all 0.3s ease',
              pointerEvents: 'auto',
              cursor: 'default'
            }} title={liveFitBadge.detail}>
              <span style={{ fontSize: '0.9rem' }}>{liveFitBadge.icon}</span>
              <span>{liveFitBadge.label}</span>
            </div>

            {/* IN-CAMERA CAROUSEL NAVIGATION OVERLAY (Bottom of Viewport - Reference Screenshot 3) */}
            {allRecommendations && allRecommendations.length > 1 && (
              <div style={{
                position: 'absolute',
                bottom: isFitAnalysisActive ? 90 : 18,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                background: 'rgba(15, 23, 42, 0.75)',
                backdropFilter: 'blur(8px)',
                padding: '6px 16px',
                borderRadius: '30px',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                pointerEvents: 'auto',
                transition: 'bottom 0.25s ease'
              }}>
                {/* Previous Frame Arrow */}
                <button
                  onClick={(e) => { e.stopPropagation(); handlePrevFrame(); }}
                  aria-label="Previous Frame"
                  style={{
                    background: 'rgba(255, 255, 255, 0.18)',
                    border: 'none',
                    color: '#ffffff',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    transition: 'all 0.18s ease',
                    outline: 'none',
                    userSelect: 'none'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'}
                >
                  ‹
                </button>

                {/* Center Frame Graphic & Name */}
                <div 
                  onClick={handleNextFrame}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    minWidth: '95px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  title="Click to switch to next frame"
                >
                  <img
                    src={apiBase + (activeFrame?.image || '')}
                    alt={activeFrame?.name}
                    style={{
                      height: '28px',
                      maxWidth: '90px',
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.5))'
                    }}
                  />
                  <span style={{
                    fontSize: '0.72rem',
                    color: '#e2e8f0',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '125px',
                    marginTop: '2px'
                  }}>
                    {activeFrame?.name || 'Frame'}
                  </span>
                </div>

                {/* Next Frame Arrow */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleNextFrame(); }}
                  aria-label="Next Frame"
                  style={{
                    background: 'rgba(255, 255, 255, 0.18)',
                    border: 'none',
                    color: '#ffffff',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    transition: 'all 0.18s ease',
                    outline: 'none',
                    userSelect: 'none'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'}
                >
                  ›
                </button>
              </div>
            )}

            {/* Fit Analysis Interactive HUD (Streamlined 3-Step) */}
            {isFitAnalysisActive && (
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                padding: '1.25rem', boxSizing: 'border-box'
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

            {/* Hidden image for canvas drawing */}
            <img ref={frameImgRef} src={apiBase + (activeFrame?.image || '')} crossOrigin="anonymous" style={{display: 'none'}} alt="" />
          </div>
        ) : (
          <div style={{width: '100%', maxWidth: '680px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)'}}>
            <img src={capturedImage} style={{width: '100%', display: 'block', transform: uploadedImage ? 'none' : 'scaleX(-1)'}} alt="Captured look" />
          </div>
        )}

        {/* Visual Simulation & Geometry Approximation Disclosure */}
        <div style={{
          width: '100%', maxWidth: '680px',
          background: '#f8fafc', border: '1px solid #cbd5e1',
          borderRadius: '8px', padding: '0.55rem 0.9rem',
          fontSize: '0.74rem', color: '#475569', lineHeight: 1.4,
          display: 'flex', alignItems: 'center', gap: '0.55rem',
          boxSizing: 'border-box'
        }}>
          <span style={{fontSize: '0.95rem', flexShrink: 0}}>ℹ️</span>
          <span>
            <strong>3D Anatomical Simulation:</strong> Frame chassis aligns to nasal bridge and eyes. Temple arms extend from hinges to Otobasion Superius (ear crest). Physical contact force and skin comfort require hands-on fitting.
          </span>
        </div>

        {/* Selected Frame Detail Bar */}
        <div style={{background: '#ffffff', padding: '0.85rem 1.25rem', borderRadius: '10px', width: '100%', maxWidth: '680px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)'}}>
          <div>
            <h3 style={{margin: '0 0 0.25rem 0', fontSize: '1.05rem', color: '#0f172a'}}>Selected: {activeFrame?.name}</h3>
            <div style={{display: 'flex', gap: '1rem', fontSize: '0.85rem', flexWrap: 'wrap'}}>
              <span style={{color: '#0284c7', fontWeight: 600}}>Style Match: {activeFrame?.final_score?.toFixed(0) || 85}%</span>
              {activeFrame?.width_mm && <span style={{color: '#64748b'}}>Width: {activeFrame.width_mm} mm</span>}
              {activeFrame?.bridge_width_mm && <span style={{color: '#64748b'}}>Bridge: {activeFrame.bridge_width_mm} mm</span>}
              {activeFrame?.temple_length_mm && <span style={{color: '#64748b'}}>Temple: {activeFrame.temple_length_mm} mm</span>}
            </div>
          </div>
          <div style={{display: 'flex', gap: '0.5rem'}}>
            {fitReport && (
              <button 
                onClick={() => setShowReportModal(true)} 
                style={{padding: '0.65rem 1.1rem', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'}}
              >
                📊 View Report
              </button>
            )}
            {!capturedImage ? (
              <button onClick={handleCapture} style={{padding: '0.65rem 1.1rem', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'}}>
                Capture Look
              </button>
            ) : (
              <button onClick={() => setCapturedImage(null)} style={{padding: '0.65rem 1.1rem', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'}}>
                Retake
              </button>
            )}
          </div>
        </div>
        
        {/* Frame Carousel Bar (Secondary list view) */}
        <div style={{width: '100%', maxWidth: '680px'}}>
          <p style={{fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.5rem'}}>Switch Virtual Frame:</p>
          <div style={{display: 'flex', gap: '0.75rem', overflowX: 'auto', paddingBottom: '0.5rem'}}>
            {allRecommendations.map(r => (
              <div 
                key={r.id} 
                onClick={() => { setActiveFrame(r); setFitReport(null); }}
                style={{
                  minWidth: '115px', border: activeFrame?.id === r.id ? '2px solid #0284c7' : '1px solid #e2e8f0', 
                  borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', background: '#ffffff', textAlign: 'center',
                  boxShadow: activeFrame?.id === r.id ? '0 0 0 1px #0284c7' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <img src={apiBase + r.image} style={{width: '100%', height: '45px', objectFit: 'contain'}} alt="" />
                <div style={{fontSize: '0.75rem', marginTop: '0.35rem', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.name}</div>
                <div style={{fontSize: '0.72rem', color: '#0284c7', fontWeight: 500}}>{r.final_score?.toFixed(0)}% Match</div>
              </div>
            ))}
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
