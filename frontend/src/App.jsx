import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import { Camera, RefreshCw, AlertTriangle, ArrowLeft } from 'lucide-react';
import './App.css';

const API_BASE = '';

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [stream, setStream] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [liveQuality, setLiveQuality] = useState({ status: 'invalid', reasons: ['waiting'] });
  const [qualityPolling, setQualityPolling] = useState(false);
  
  const [phase1Result, setPhase1Result] = useState(null);
  const [phase2Result, setPhase2Result] = useState(null);
  const [showResults, setShowResults] = useState(false);
  
  const [recommendations, setRecommendations] = useState(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  
  const faceShapeLocked = useRef(false);

  // Poll for quality when camera is active
  useEffect(() => {
    let intervalId;
    
    const checkQuality = async () => {
      if (!videoRef.current || !stream || showResults || isAnalyzing) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      try {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.5)); // low quality for speed
        if (!blob) return;
        
        const fd = new FormData();
        fd.append('image', blob, 'quality.jpg');
        
        const res = await axios.post(`${API_BASE}/api/analyze/quality`, fd);
        setLiveQuality(res.data.quality);
      } catch (err) {
        // silently fail polling
      }
    };
    
    if (stream && !showResults && !isAnalyzing) {
      intervalId = setInterval(checkQuality, 800);
    }
    
    return () => clearInterval(intervalId);
  }, [stream, showResults, isAnalyzing]);

  useEffect(() => {
    if (showResults && phase1Result && !phase1Result.error && phase2Result && phase2Result.quality?.status === 'valid') {
      const fetchRecs = async () => {
        setIsLoadingRecs(true);
        try {
          const reqBody = {
            face_shape: phase1Result.face_shape,
            face_shape_confidence: phase1Result.confidence,
            ipd_mm: phase2Result.ipd?.ipd_mm || 63.0,
            ipd_method: phase2Result.ipd?.method || "estimated",
            skin_tone: phase2Result.skin_tone?.skin_tone || "Medium",
            undertone: phase2Result.skin_tone?.undertone || "Neutral"
          };
          
          console.log("RECOMMENDATION INPUT:", {
            face_shape: reqBody.face_shape,
            ipd_mm: reqBody.ipd_mm,
            skin_tone: reqBody.skin_tone,
            undertone: reqBody.undertone
          });
          
          const res = await axios.post(`${API_BASE}/api/recommendations`, reqBody);
          setRecommendations(res.data.recommendations);
        } catch (err) {
          console.error("Failed to fetch recommendations:", err);
        } finally {
          setIsLoadingRecs(false);
        }
      };
      fetchRecs();
    }
  }, [showResults, phase1Result, phase2Result]);

  useEffect(() => {
    if (stream && videoRef.current && !showResults) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.error("Error playing video:", e));
    }
  }, [stream, showResults]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  const startCamera = async () => {
    setErrorMsg('');
    setPhase1Result(null);
    setPhase2Result(null);
    setRecommendations(null);
    setShowResults(false);
    setLiveQuality({ status: 'invalid', reasons: ['waiting'] });
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      setStream(mediaStream);
    } catch (err) {
      setErrorMsg('Camera permission denied or camera unavailable.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !stream) return;
    
    setErrorMsg('');
    
    // Check if live quality is valid. If not, block capture and warn user.
    if (liveQuality.status !== 'valid' && liveQuality.reasons.length > 0 && !liveQuality.reasons.includes('waiting')) {
       // We can allow capture anyway and let the main flow reject it, or block it. 
       // Prompt: "Before sending it for analysis, run the existing image-quality validation. If the image fails... show the exact reason... 'Please adjust your position and try again.'"
       // We'll let it pass to the main capture logic so we have a full res check.
    }
    
    setIsAnalyzing(true);
    setPhase1Result(null);
    setPhase2Result(null);
    setRecommendations(null);
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    // Immediate capture for primary image
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const primaryBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    
    // Capture ~14 more frames rapidly for stable IPD
    const frames = [primaryBlob];
    for (let i = 0; i < 14; i++) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
        if (blob) frames.push(blob);
        await new Promise(res => setTimeout(res, 50));
    }
    
    if (frames.length === 0 || !primaryBlob) {
        setErrorMsg('Failed to capture image from camera.');
        setIsAnalyzing(false);
        return;
    }
    
    setCapturedImage(URL.createObjectURL(primaryBlob));
    
    // Check quality of primary frame first
    const fdQuality = new FormData();
    fdQuality.append('image', primaryBlob, 'capture.jpg');
    try {
        const qualityRes = await axios.post(`${API_BASE}/api/analyze/quality`, fdQuality);
        if (qualityRes.data.quality.status !== 'valid') {
            setPhase2Result({ quality: qualityRes.data.quality });
            setShowResults(true);
            setIsAnalyzing(false);
            return; // STOP! Do not continue to phase 1 / phase 2
        }
    } catch (e) {
        // continue if quality check fails network
    }
    
    const formDataPrimary = new FormData();
    formDataPrimary.append('image', primaryBlob, 'capture.jpg');
    
    try {
        const p1 = axios.post(`${API_BASE}/api/analyze/phase1`, formDataPrimary, {
          headers: { 'Content-Type': 'multipart/form-data' }
        }).catch(e => e.response || { data: { error: 'Face Shape API unavailable' } });
        
        // Send all frames to Phase 2 for IPD aggregation
        const phase2Promises = frames.map(blob => {
            const fd = new FormData();
            fd.append('image', blob, `frame.jpg`);
            return axios.post(`${API_BASE}/api/analyze/phase2`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            }).catch(e => null);
        });
        
        const [res1, ...res2Array] = await Promise.all([p1, ...phase2Promises]);
        
        const validRes2 = res2Array.filter(r => r && r.data && r.data.quality?.status === 'valid');
        const primaryRes2 = res2Array[0]?.data || { quality: { status: 'invalid', reasons: ['API unavailable'] } };
        
        if (res1.data.error) {
          if (!faceShapeLocked.current) setPhase1Result({ error: res1.data.error });
        } else {
          if (!faceShapeLocked.current) {
            setPhase1Result(res1.data);
            faceShapeLocked.current = true;
            console.log("PRIMARY IMAGE FACE SHAPE:", res1.data.face_shape);
            console.log("FACE SHAPE CONFIDENCE:", res1.data.confidence);
            console.log("FACE SHAPE LOCKED:", faceShapeLocked.current);
          }
        }
        
        let finalIpd = primaryRes2.ipd;

        if (validRes2.length > 0) {
            const validIpds = validRes2.map(r => r.data.ipd).filter(i => i && i.status === 'valid' && i.ipd_mm != null);
            
            if (validIpds.length >= 8) {
                const values = validIpds.map(i => i.ipd_mm).sort((a, b) => a - b);
                const median = values[Math.floor(values.length / 2)];
                const deviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
                const mad = deviations[Math.floor(deviations.length / 2)];
                
                // Filter outliers (> 3 * MAD)
                const threshold = Math.max(mad * 3.0, 1.0);
                const stableIpds = values.filter(v => Math.abs(v - median) <= threshold);
                
                if (stableIpds.length >= 8) {
                    const finalMedian = stableIpds[Math.floor(stableIpds.length / 2)];
                    const finalDeviations = stableIpds.map(v => Math.abs(v - finalMedian)).sort((a, b) => a - b);
                    const finalMad = finalDeviations[Math.floor(finalDeviations.length / 2)];
                    
                    if (finalMad <= 2.0) {
                        finalIpd = {
                            status: 'valid',
                            ipd_mm: finalMedian,
                            mad: finalMad,
                            frames_used: stableIpds.length,
                            method: validIpds[0].method || 'iris-calibrated'
                        };
                        
                        // Scale measurements to match the median IPD exactly
                        if (primaryRes2.ipd?.ipd_mm && finalMedian && primaryRes2.measurements) {
                            const scale = finalMedian / primaryRes2.ipd.ipd_mm;
                            for (const key in primaryRes2.measurements) {
                                primaryRes2.measurements[key] = primaryRes2.measurements[key] * scale;
                            }
                        }
                    } else {
                        finalIpd = { status: 'invalid', message: 'IPD measurement is unstable. Please keep your face straight and try again.' };
                    }
                } else {
                    finalIpd = { status: 'invalid', message: 'IPD measurement is unstable. Please keep your face straight and try again.' };
                }
            } else {
                finalIpd = { status: 'invalid', message: 'IPD measurement is unstable. Please keep your face straight and try again.' };
            }
        } else {
            finalIpd = { status: 'invalid', message: 'No valid frames captured. Ensure your face is clearly visible.' };
        }
        
        setPhase2Result({
            ...primaryRes2,
            ipd: finalIpd
        });
        
        setShowResults(true);
    } catch (err) {
        setErrorMsg('Backend error. Is the server running?');
    } finally {
        setIsAnalyzing(false);
    }
  }, [stream, liveQuality]);

  const analyzeAgain = () => {
    faceShapeLocked.current = false;
    setPhase1Result(null);
    setPhase2Result(null);
    setRecommendations(null);
    setShowResults(false);
    setErrorMsg('');
  };

  const getQualityMessage = (reason) => {
    const reasons = {
      'no_face': 'Move into the frame',
      'multiple_faces': 'Only one person should be visible',
      'face_too_small': 'Move closer',
      'too_dark': 'Move to a brighter area',
      'too_bright': 'Lighting is too harsh',
      'blur': 'Hold the phone steady',
      'excessive_head_pose': 'Keep your head straight',
      'invalid_image': 'Image invalid',
      'waiting': 'Position your face inside the frame'
    };
    return reasons[reason] || reason;
  };

  const [imgError, setImgError] = useState({});

  return (
    <div className="dashboard">
      <header>
        <div className="logo-section">
          <h1>SmartFrame AI</h1>
          <div className="subtitle">Phase 3: Production Flow & Recommendations</div>
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
            <div className="panel" style={{height: '100%'}}>
              <div className="tabs">
                <button className="tab active">Capture Photo</button>
              </div>
              
              <div className="camera-container" style={{position: 'relative'}}>
                {!showResults ? (
                  <>
                    {stream ? <video ref={videoRef} autoPlay playsInline muted className="video-element" /> : <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b'}}>Capture Photo</div>}
                    <div className="alignment-guide"></div>
                    
                    {/* Live Guidance Overlay */}
                    {stream && !isAnalyzing && (
                      <div className="live-guidance">
                        <div className="status-pill">
                          {liveQuality.status === 'valid' ? (
                            <span style={{color: 'var(--success)'}}>Face aligned ✓</span>
                          ) : (
                            <span style={{color: '#d97706', fontWeight: 500}}>
                              {getQualityMessage(liveQuality.reasons[0])}
                            </span>
                          )}
                        </div>
                        <div className="live-checklist">
                          <div className={liveQuality.reasons.includes('no_face') ? 'check-item invalid' : 'check-item valid'}>
                            Face: {liveQuality.reasons.includes('no_face') ? '✗' : '✓'}
                          </div>
                          <div className={(liveQuality.reasons.includes('too_dark') || liveQuality.reasons.includes('too_bright')) ? 'check-item invalid' : 'check-item valid'}>
                            Lighting: {(liveQuality.reasons.includes('too_dark') || liveQuality.reasons.includes('too_bright')) ? '✗' : '✓'}
                          </div>
                          <div className={liveQuality.reasons.includes('excessive_head_pose') ? 'check-item invalid' : 'check-item valid'}>
                            Pose: {liveQuality.reasons.includes('excessive_head_pose') ? '✗' : '✓'}
                          </div>
                          <div className={liveQuality.reasons.includes('face_too_small') ? 'check-item invalid' : 'check-item valid'}>
                            Position: {liveQuality.reasons.includes('face_too_small') ? 'Move closer' : '✓'}
                          </div>
                        </div>
                      </div>
                    )}

                  </>
                ) : (
                  capturedImage ? <img src={capturedImage} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)'}} alt='Captured frame' /> : <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b'}}>Camera Paused</div>
                )}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>

              <div className="controls" style={{ flexDirection: 'column' }}>
                {!showResults ? (
                  <>
                    <div style={{display: 'flex', gap: '1rem'}}>
                      {!stream ? (
                        <button onClick={startCamera} className="btn primary" style={{flex:1}}>Start Camera</button>
                      ) : (
                        <>
                          <button onClick={stopCamera} className="btn secondary" disabled={isAnalyzing}>Stop Camera</button>
                          <button onClick={captureAndAnalyze} disabled={isAnalyzing} className="btn primary">
                            {isAnalyzing ? <RefreshCw className="spin" size={18} /> : 'Capture'}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <button onClick={analyzeAgain} className="btn primary">
                    <ArrowLeft size={18} /> Analyze Again
                  </button>
                )}
              </div>
              {errorMsg && <div className="warning-text" style={{marginTop: '1rem', textAlign: 'center'}}>{errorMsg}</div>}
            </div>
          </div>

          {/* RIGHT PANEL */}
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
                <button onClick={analyzeAgain} className="btn primary" style={{width: '200px', margin: '0 auto'}}>Analyze Again</button>
              </div>
            ) : showResults ? (
              <div className="panel">
                <span className="section-title">YOUR SMARTFRAME ANALYSIS</span>
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
                      {phase1Result && !phase1Result.error ? (
                        <>
                          <div className="primary-stat">
                            {phase1Result.face_shape} 
                            <span style={{fontSize: '0.6em', marginLeft: '8px', padding: '2px 6px', background: 'rgba(5, 150, 105, 0.1)', color: 'var(--success)', borderRadius: '4px'}}>
                              LOCKED
                            </span>
                          </div>
                          <div className="secondary-stat">Confidence: {(phase1Result.confidence * 100).toFixed(0)}%</div>
                          {phase1Result.confidence < 0.5 && <div className="warning-text">Low confidence — recommendations may be less reliable.</div>}
                        </>
                      ) : (
                        <div className="secondary-stat">{phase1Result?.error || 'Unavailable'}</div>
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
              <div className="panel" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)'}}>
                Awaiting scan...
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM SECTION: RECOMMENDATIONS */}
        {showResults && phase2Result && (!phase2Result.quality || phase2Result.quality.status === 'valid') && phase2Result.ipd?.status === 'valid' && (
          <>
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

            <div className="panel">
              <span className="section-title">RECOMMENDED FRAMES FOR YOU</span>
            {isLoadingRecs ? (
              <div className="secondary-stat">Calculating scores based on your features...</div>
            ) : recommendations ? (
              <div className="frames-grid">
                {recommendations.map(frame => (
                  <div key={frame.id} className="frame-card" style={{display: 'flex', flexDirection: 'column'}}>
                    
                    <div className="frame-image-box" style={{background: '#ffffff', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem'}}>
                      {!imgError[frame.id] ? (
                        <img 
                          src={frame.image} 
                          alt={frame.name} 
                          onError={() => setImgError(prev => ({...prev, [frame.id]: true}))}
                          style={{width: '100%', height: '160px', objectFit: 'contain'}}
                        />
                      ) : (
                        <div style={{width: '100%', height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)'}}>
                          Image unavailable
                        </div>
                      )}
                    </div>

                    <div className="frame-info" style={{marginTop: '1rem', flex: 1}}>
                      <h4 style={{fontSize: '1.2rem', margin: '0 0 0.5rem 0'}}>{frame.name}</h4>
                      <div className="secondary-stat" style={{marginBottom: '1rem'}}>
                        {frame.category} • {frame.color} • ₹{frame.price}
                      </div>
                      
                      <div style={{marginBottom: '0.5rem'}}>
                        <strong>Compatibility: {frame.final_score.toFixed(0)}%</strong>
                      </div>
                      {frame.ipd_fit_score != null && (<div style={{marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)'}}>IPD Fit: {frame.ipd_fit_score > 85 ? 'Excellent' : frame.ipd_fit_score > 70 ? 'Good' : 'Adequate'}</div>)}
                    </div>
                    
                    <button className="btn primary" style={{marginTop: '1rem', width: '100%'}}>
                      Try On
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="secondary-stat">No recommendations available.</div>
            )}
            </div>
          </>
        )}

      </main>
    </div>
  );
}

export default App;
