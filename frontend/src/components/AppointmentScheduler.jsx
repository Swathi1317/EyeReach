import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Calendar, 
  Clock, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Video, 
  Building2, 
  CheckCircle2, 
  AlertCircle, 
  ArrowLeft, 
  RotateCcw, 
  Sparkles, 
  Eye, 
  Home, 
  Users, 
  FileText,
  Copy,
  Check,
  Printer,
  Camera,
  Activity,
  Stethoscope,
  ShieldCheck,
  Glasses
} from 'lucide-react';

const API_BASE = '';

const PURPOSE_OPTIONS = [
  'Doorstep Spectacle Trial & Frame Fitting Verification',
  'Comprehensive Home Eye & Vision Exam',
  'Senior Citizen Doorstep Vision Check',
  'Refraction, Power Testing & Lens Prescription',
  'Mobile Frame Trial & Fit Verification',
  'Pediatric & Student Vision Screening',
  'Custom Request'
];

const TIME_SLOTS = [
  '09:00 AM',
  '10:30 AM',
  '12:00 PM',
  '02:00 PM',
  '03:30 PM',
  '05:00 PM',
  '06:30 PM'
];

export default function AppointmentScheduler({ 
  onBack, 
  onOpenScan = null,
  onOpenBoutique = null,
  defaultUser = null,
  faceAnalysisData = null,
  preSelectedFrames = []
}) {
  const todayISO = new Date().toISOString().split('T')[0];

  // Extract Face Analysis Data & Generated Face Sketch
  const hasFaceAnalysis = Boolean(
    faceAnalysisData && (
      (faceAnalysisData.phase1Result && faceAnalysisData.phase1Result.face_shape) ||
      (faceAnalysisData.phase2Result && (faceAnalysisData.phase2Result.annotated_image || faceAnalysisData.phase2Result.ipd)) ||
      faceAnalysisData.capturedImage
    )
  );

  const faceShape = faceAnalysisData?.phase1Result?.face_shape || null;
  const faceShapeConfidence = faceAnalysisData?.phase1Result?.confidence 
    ? Math.round(faceAnalysisData.phase1Result.confidence * 100) 
    : null;
  const ipdMm = faceAnalysisData?.phase2Result?.ipd?.status === 'valid'
    ? faceAnalysisData.phase2Result.ipd.ipd_mm
    : (faceAnalysisData?.phase2Result?.ipd?.ipd_mm || null);
  const eyeShape = faceAnalysisData?.phase2Result?.eye_shape?.eye_shape || null;
  const skinTone = faceAnalysisData?.phase2Result?.skin_tone?.skin_tone || null;
  const undertone = faceAnalysisData?.phase2Result?.skin_tone?.undertone || null;
  const faceWidthMm = faceAnalysisData?.phase2Result?.measurements?.cheekbone_width_mm || null;
  const faceLengthMm = faceAnalysisData?.phase2Result?.measurements?.face_length_mm || null;
  const jawWidthMm = faceAnalysisData?.phase2Result?.measurements?.jaw_width_mm || null;
  const headCircumferenceCm = faceAnalysisData?.headCircumferenceResult?.head_circumference_cm || null;
  const eyeToEarMm = faceAnalysisData?.rightSideResult?.measurements?.eye_to_ear_distance_mm || 
                     faceAnalysisData?.leftSideResult?.measurements?.eye_to_ear_distance_mm || null;
  const faceSketchImage = faceAnalysisData?.phase2Result?.annotated_image || faceAnalysisData?.capturedImage || null;

  // Form State: Exclusively Home Testing / Home Visit Appointment
  const appointmentType = 'home_testing';
  const [fullName, setFullName] = useState(defaultUser?.name || defaultUser?.owner_name || '');
  const [mobileNumber, setMobileNumber] = useState(defaultUser?.mobile || defaultUser?.mobile_number || '');
  const [email, setEmail] = useState(defaultUser?.email || '');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('10:30 AM');
  const [homeAddress, setHomeAddress] = useState(defaultUser?.address || defaultUser?.shop_address || '');
  const [purpose, setPurpose] = useState(PURPOSE_OPTIONS[0]);
  const [customPurpose, setCustomPurpose] = useState('');
  const [additionalMessage, setAdditionalMessage] = useState('');

  // EyeReach Collection Integration
  const [availablePicks, setAvailablePicks] = useState([]);
  const [selectedFrameIds, setSelectedFrameIds] = useState(new Set());
  const [loadingPicks, setLoadingPicks] = useState(true);

  // Fetch saved customer frame picks
  useEffect(() => {
    const token = localStorage.getItem('smartframe_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const params = defaultUser?.mobile ? { customer_mobile: defaultUser.mobile } : {};

    axios.get('/api/customer/picks', { headers, params })
      .then((res) => {
        const picksList = res.data?.picks || [];
        const combinedMap = new Map();

        // 1. Prioritize pre-selected frames passed from scan recommendations or boutique
        if (preSelectedFrames && preSelectedFrames.length > 0) {
          preSelectedFrames.forEach(f => {
            const pId = String(f.product_id || f.id);
            combinedMap.set(pId, {
              product_id: pId,
              id: f.id || pId,
              name: f.name,
              brand: f.brand,
              shape: f.shape || f.category,
              color: f.color,
              price: f.price,
              material: f.material,
              front_image: f.front_image || f.image,
              lens_width_mm: f.lens_width_mm,
              bridge_width_mm: f.bridge_width_mm,
              temple_length_mm: f.temple_length_mm
            });
          });
        }

        // 2. Add saved picks from customer collection
        picksList.forEach(p => {
          const pId = String(p.product_id || p.id);
          if (!combinedMap.has(pId)) {
            combinedMap.set(pId, p);
          }
        });

        const combinedList = Array.from(combinedMap.values());
        setAvailablePicks(combinedList);

        const initialSelected = new Set();
        if (preSelectedFrames && preSelectedFrames.length > 0) {
          preSelectedFrames.slice(0, 10).forEach(f => initialSelected.add(String(f.product_id || f.id)));
        } else {
          combinedList.slice(0, 10).forEach(p => initialSelected.add(String(p.product_id || p.id)));
        }
        setSelectedFrameIds(initialSelected);
      })
      .catch((err) => {
        console.error('Error fetching picks for appointment:', err);
      })
      .finally(() => {
        setLoadingPicks(false);
      });
  }, [defaultUser?.mobile, preSelectedFrames]);

  const handleToggleFrameSelect = (pId) => {
    setSelectedFrameIds(prev => {
      const next = new Set(prev);
      if (next.has(pId)) {
        next.delete(pId);
      } else {
        if (next.size >= 10) {
          alert('You can select a maximum of 10 frames to try at home.');
          return prev;
        }
        next.add(pId);
      }
      return next;
    });
  };

  const handleSelectAllFrames = () => {
    const all = new Set(availablePicks.slice(0, 10).map(p => String(p.product_id || p.id)));
    setSelectedFrameIds(all);
  };

  const handleClearFrameSelection = () => {
    setSelectedFrameIds(new Set());
  };

  // UI States
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmationData, setConfirmationData] = useState(null);
  const [copiedId, setCopiedId] = useState(false);

  // Form Reset
  const handleReset = () => {
    setFullName(defaultUser?.name || defaultUser?.owner_name || '');
    setMobileNumber(defaultUser?.mobile || defaultUser?.mobile_number || '');
    setEmail(defaultUser?.email || '');
    setAppointmentDate('');
    setAppointmentTime('10:30 AM');
    setHomeAddress(defaultUser?.address || defaultUser?.shop_address || '');
    setPurpose(PURPOSE_OPTIONS[0]);
    setCustomPurpose('');
    setAdditionalMessage('');
    setErrorMessage('');
    setConfirmationData(null);
  };

  const getFormattedDateSummary = (dateStr) => {
    if (!dateStr) return 'Please choose a date';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return d.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      }
    } catch {
      // fallback
    }
    return dateStr;
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!mobileNumber.trim() || mobileNumber.trim().length < 8) {
      setErrorMessage('Please enter a valid mobile number (at least 8 digits).');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!appointmentDate) {
      setErrorMessage('Please select an appointment date.');
      return;
    }
    if (appointmentDate < todayISO) {
      setErrorMessage('Appointment date cannot be in the past. Please select today or a future date.');
      return;
    }
    if (!appointmentTime) {
      setErrorMessage('Please choose your preferred appointment time.');
      return;
    }

    if (!homeAddress.trim() || homeAddress.trim().length < 6) {
      setErrorMessage('Please provide your complete home address for the doorstep testing team.');
      return;
    }

    if (selectedFrameIds.size === 0) {
      setErrorMessage('Please select at least 1 spectacle frame (maximum 10 frames) for the doctor/optometrist to bring to your home.');
      return;
    }

    if (selectedFrameIds.size > 10) {
      setErrorMessage('Please select a maximum of 10 spectacle frames for your home visit trial.');
      return;
    }

    const finalPurpose = purpose.includes('Custom') && customPurpose.trim()
      ? customPurpose.trim()
      : purpose;

    const chosenFrames = availablePicks.filter(p => selectedFrameIds.has(String(p.product_id || p.id)));

    setSubmitting(true);
    try {
      const payload = {
        appointment_type: 'Schedule a Home Testing Appointment',
        full_name: fullName.trim(),
        mobile_number: mobileNumber.trim(),
        email: email.trim(),
        appointment_date: appointmentDate,
        appointment_time: appointmentTime,
        meeting_mode: null,
        home_address: homeAddress.trim(),
        purpose: finalPurpose,
        additional_message: additionalMessage.trim() || null,
        selected_frames: chosenFrames.map(f => ({
          product_id: f.product_id || f.id,
          brand: f.brand,
          name: f.name,
          shape: f.shape,
          color: f.color,
          price: f.price,
          material: f.material,
          front_image: f.front_image
        })),
        // Transfer available face analysis & sketch to doctor file
        face_analysis: hasFaceAnalysis ? {
          face_shape: faceShape,
          face_shape_confidence: faceShapeConfidence ? faceShapeConfidence / 100 : null,
          ipd_mm: ipdMm,
          eye_shape: eyeShape,
          skin_tone: skinTone,
          undertone: undertone,
          face_width_mm: faceWidthMm,
          face_length_mm: faceLengthMm,
          jaw_width_mm: jawWidthMm,
          head_circumference_cm: headCircumferenceCm,
          face_sketch_image: faceSketchImage,
          face_analysis_summary: `${faceShape || 'Standard'} face shape, ${ipdMm ? ipdMm + 'mm IPD' : 'IPD calibrated'}, ${skinTone || 'Medium'} skin tone, Face Width ${faceWidthMm || 'standard'}mm`
        } : null
      };

      const res = await axios.post(`${API_BASE}/api/appointments`, payload);
      setConfirmationData(res.data);
    } catch (err) {
      console.error('Error submitting appointment:', err);
      const detail = err.response?.data?.detail;
      setErrorMessage(
        typeof detail === 'string'
          ? detail
          : 'Unable to schedule appointment. Please check your inputs and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyAppointmentId = () => {
    if (confirmationData?.appointment_id) {
      navigator.clipboard.writeText(confirmationData.appointment_id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2500);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      color: '#0f172a',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    }}>
      {/* Top Header / Brand Bar */}
      <header style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '1rem 2rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        position: 'sticky',
        top: 0,
        zIndex: 30
      }}>
        <div style={{
          maxWidth: '1100px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 4px 10px rgba(2, 132, 199, 0.25)'
              }}>
                <Eye size={22} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0369a1', letterSpacing: '-0.02em' }}>
                    EyeReach – Home Testing App
                  </h1>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                  Certified Doorstep Optical Care & Doctor Consultation
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.8rem',
              color: '#0f766e',
              background: '#ccfbf1',
              padding: '6px 12px',
              borderRadius: '20px',
              fontWeight: 600
            }}>
              <Stethoscope size={14} />
              Doctor Direct File Transfer
            </div>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main style={{ maxWidth: '920px', margin: '0 auto', padding: '2rem 1.25rem 4rem' }}>
        
        {/* SUCCESS / CONFIRMATION VIEW */}
        {confirmationData ? (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.05)',
            overflow: 'hidden'
          }}>
            {/* Header banner */}
            <div style={{
              background: 'linear-gradient(135deg, #0d9488 0%, #0284c7 100%)',
              color: '#ffffff',
              padding: '2.5rem 2rem',
              textAlign: 'center'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(8px)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
                border: '2px solid rgba(255, 255, 255, 0.4)'
              }}>
                <CheckCircle2 size={36} color="#ffffff" />
              </div>
              <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 0.5rem' }}>
                Your appointment request has been submitted successfully!
              </h2>
              <p style={{ margin: 0, opacity: 0.9, fontSize: '0.95rem', maxWidth: '560px', marginInline: 'auto' }}>
                Thank you, {confirmationData.full_name}. Your appointment details and biometric facial analysis have been recorded and sent to the attending doctor's schedule.
              </p>
            </div>

            <div style={{ padding: '2rem' }}>
              
              {/* Doctor Notice Card */}
              <div style={{
                backgroundColor: '#f0fdfa',
                border: '1px solid #99f6e4',
                borderRadius: '14px',
                padding: '1rem 1.25rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: '#0d9488',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Stethoscope size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f766e' }}>
                    Sent to Attending Optometrist / Doctor
                  </div>
                  <div style={{ fontSize: '0.80rem', color: '#334155', marginTop: '2px' }}>
                    {confirmationData.face_shape 
                      ? `Your face sketch and clinical biometric measurements (${confirmationData.face_shape} shape, ${confirmationData.ipd_mm || 'calibrated'}mm IPD) are stored in the doctor's appointment record.`
                      : 'Your appointment is registered in the clinic database. You can review your booking below.'}
                  </div>
                </div>
              </div>

              {/* Appointment Details Grid */}
              <div style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: '1rem',
                  marginBottom: '1.25rem',
                  flexWrap: 'wrap',
                  gap: '10px'
                }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>
                      Appointment Reference ID
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                      <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0369a1', fontFamily: 'monospace' }}>
                        {confirmationData.appointment_id}
                      </span>
                      <button
                        onClick={handleCopyAppointmentId}
                        style={{
                          background: copiedId ? '#dcfce7' : '#ffffff',
                          color: copiedId ? '#15803d' : '#475569',
                          border: '1px solid #cbd5e1',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                      >
                        {copiedId ? <Check size={13} /> : <Copy size={13} />}
                        {copiedId ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {confirmationData.status === 'Pending' ? (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: '#fef3c7',
                      color: '#b45309',
                      padding: '6px 14px',
                      borderRadius: '999px',
                      fontWeight: 700,
                      fontSize: '0.85rem'
                    }}>
                      <Clock size={15} />
                      Pending Doctor Review
                    </span>
                  ) : confirmationData.status === 'Rejected' ? (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: '#fee2e2',
                      color: '#b91c1c',
                      padding: '6px 14px',
                      borderRadius: '999px',
                      fontWeight: 700,
                      fontSize: '0.85rem'
                    }}>
                      <AlertCircle size={15} />
                      Rejected
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: '#dcfce7',
                      color: '#15803d',
                      padding: '6px 14px',
                      borderRadius: '999px',
                      fontWeight: 700,
                      fontSize: '0.85rem'
                    }}>
                      <CheckCircle2 size={15} />
                      {confirmationData.status}
                    </span>
                  )}
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1.25rem'
                }}>
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Customer / Patient Name</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                      {confirmationData.full_name}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Appointment Type</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0369a1', marginTop: '2px' }}>
                      {confirmationData.appointment_type_label}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Selected Date</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Calendar size={16} color="#0284c7" />
                      {getFormattedDateSummary(confirmationData.appointment_date)}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Selected Time</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Clock size={16} color="#0d9488" />
                      {confirmationData.appointment_time}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Contact Details</div>
                    <div style={{ fontSize: '0.88rem', color: '#334155', marginTop: '2px' }}>
                      📞 {confirmationData.mobile_number} <br />
                      ✉️ {confirmationData.email}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                      Doorstep Testing Address
                    </div>
                    <div style={{ fontSize: '0.88rem', color: '#334155', marginTop: '2px', fontWeight: 600 }}>
                      <span style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                        <MapPin size={16} color="#0d9488" style={{ marginTop: '2px', flexShrink: 0 }} />
                        {confirmationData.home_address}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Selected Frames for Doorstep Trial */}
                {confirmationData.selected_frames && confirmationData.selected_frames.length > 0 && (
                  <div style={{
                    marginTop: '1.25rem',
                    paddingTop: '1.25rem',
                    borderTop: '1px solid #e2e8f0'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.86rem',
                      fontWeight: 700,
                      color: '#0f766e',
                      marginBottom: '10px'
                    }}>
                      <Glasses size={16} color="#0d9488" />
                      Frames to be brought for Home Trial ({confirmationData.selected_frames.length}):
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                      gap: '10px'
                    }}>
                      {confirmationData.selected_frames.map((frame, idx) => (
                        <div key={idx} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          backgroundColor: '#ffffff',
                          padding: '8px 12px',
                          borderRadius: '12px',
                          border: '1px solid #cbd5e1'
                        }}>
                          {frame.front_image && (
                            <img
                              src={frame.front_image}
                              alt={frame.name}
                              style={{ width: '48px', height: '32px', objectFit: 'contain' }}
                            />
                          )}
                          <div style={{ overflow: 'hidden' }}>
                            <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                              {frame.name}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                              {frame.shape} • {frame.color}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Face Biometrics Summary (If Transferred) */}
                {confirmationData.face_shape && (
                  <div style={{
                    marginTop: '1.25rem',
                    paddingTop: '1.25rem',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    flexWrap: 'wrap'
                  }}>
                    {confirmationData.face_sketch_image && (
                      <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        border: '2px solid #0d9488',
                        flexShrink: 0,
                        backgroundColor: '#0f172a'
                      }}>
                        <img 
                          src={confirmationData.face_sketch_image} 
                          alt="Face Sketch" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f766e', textTransform: 'uppercase' }}>
                        Attached Biometric Findings
                      </div>
                      <div style={{ fontSize: '0.88rem', color: '#1e293b', fontWeight: 600, marginTop: '2px' }}>
                        Face Shape: <strong>{confirmationData.face_shape}</strong> • IPD: <strong>{confirmationData.ipd_mm || 'Calibrated'} mm</strong>
                      </div>
                      {confirmationData.face_analysis_summary && (
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                          {confirmationData.face_analysis_summary}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={handleReset}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.92rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)'
                  }}
                >
                  <RotateCcw size={16} />
                  Schedule Another Appointment
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '12px',
                    fontWeight: 600,
                    fontSize: '0.92rem',
                    cursor: 'pointer'
                  }}
                >
                  <Printer size={16} />
                  Print Receipt
                </button>

                {onBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      backgroundColor: '#f1f5f9',
                      color: '#0f172a',
                      border: '1px solid #cbd5e1',
                      padding: '0.75rem 1.5rem',
                      borderRadius: '12px',
                      fontWeight: 600,
                      fontSize: '0.92rem',
                      cursor: 'pointer'
                    }}
                  >
                    <ArrowLeft size={16} />
                    Back to Store
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* FORM VIEW */
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '24px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden'
          }}>
            {/* Title Section */}
            <div style={{
              padding: '2.25rem 2.25rem 1.5rem',
              borderBottom: '1px solid #f1f5f9',
              textAlign: 'center'
            }}>
              <span style={{
                backgroundColor: '#f0fdfa',
                color: '#0f766e',
                border: '1px solid #ccfbf1',
                padding: '4px 12px',
                borderRadius: '999px',
                fontSize: '0.78rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}>
                EyeReach • Healthcare Appointment
              </span>
              <h2 style={{
                fontSize: '1.9rem',
                fontWeight: 800,
                color: '#0f172a',
                margin: '0.65rem 0 0.35rem',
                letterSpacing: '-0.02em'
              }}>
                Schedule an Appointment
              </h2>
              <p style={{
                margin: 0,
                color: '#64748b',
                fontSize: '0.95rem',
                maxWidth: '600px',
                marginInline: 'auto'
              }}>
                Book an optical consultation or home eye testing visit. Your biometric facial analysis details will automatically attach to your doctor's clinical review.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ padding: '2rem 2.25rem' }}>
              
              {/* SECTION 1: HOME TESTING / HOME VISIT APPOINTMENT */}
              <div style={{ marginBottom: '2rem' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  color: '#334155',
                  marginBottom: '0.75rem'
                }}>
                  1. Appointment Service
                </label>

                <div style={{
                  padding: '1.35rem 1.6rem',
                  borderRadius: '16px',
                  border: '2px solid #0d9488',
                  backgroundColor: '#f0fdfa',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  boxShadow: '0 4px 16px rgba(13, 148, 136, 0.08)'
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '14px',
                    backgroundColor: '#0d9488',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Home size={26} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: '1.08rem', color: '#0f766e' }}>
                        Home Testing / Home Visit Appointment
                      </span>
                      <span style={{
                        backgroundColor: '#ccfbf1',
                        color: '#0f766e',
                        border: '1px solid #99f6e4',
                        padding: '2px 10px',
                        borderRadius: '999px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em'
                      }}>
                        Doorstep Service
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: '#475569', lineHeight: 1.45 }}>
                      Our certified optometrist and healthcare representative will visit your home with your selected spectacle frames for doorstep trial, precision fitting, and complete vision evaluation.
                    </p>
                  </div>
                </div>
              </div>

              {/* SECTION 2: AUTOMATICALLY POPULATED FACE ANALYSIS & SKETCH CARD */}
              <div style={{
                marginBottom: '2rem',
                backgroundColor: hasFaceAnalysis ? '#f0fdfa' : '#f8fafc',
                borderRadius: '18px',
                border: hasFaceAnalysis ? '1.5px solid #99f6e4' : '1px dashed #cbd5e1',
                padding: '1.4rem 1.6rem'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  marginBottom: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={18} color="#0d9488" />
                    <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#0f766e' }}>
                      2. Biometric Facial Analysis & Scan Sketch (Auto-Transferred)
                    </h3>
                  </div>

                  {hasFaceAnalysis ? (
                    <span style={{
                      backgroundColor: '#ccfbf1',
                      color: '#0f766e',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <CheckCircle2 size={13} />
                      Scan Data Attached to File
                    </span>
                  ) : (
                    onOpenScan && (
                      <button
                        type="button"
                        onClick={onOpenScan}
                        style={{
                          background: '#ffffff',
                          color: '#0284c7',
                          border: '1px solid #bae6fd',
                          padding: '4px 10px',
                          borderRadius: '8px',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Camera size={13} />
                        Run Quick Face Scan
                      </button>
                    )
                  )}
                </div>

                {hasFaceAnalysis ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.5rem',
                    flexWrap: 'wrap'
                  }}>
                    {/* Face Sketch / Scan Image Preview */}
                    {faceSketchImage && (
                      <div style={{
                        position: 'relative',
                        width: '120px',
                        height: '140px',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        border: '2px solid #0d9488',
                        backgroundColor: '#0f172a',
                        boxShadow: '0 4px 12px rgba(13, 148, 136, 0.15)',
                        flexShrink: 0
                      }}>
                        <img 
                          src={faceSketchImage} 
                          alt="Face Analysis Sketch" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          backgroundColor: 'rgba(15, 23, 42, 0.85)',
                          color: '#5eead4',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '3px 4px',
                          textAlign: 'center',
                          letterSpacing: '0.03em'
                        }}>
                          FACE SKETCH
                        </div>
                      </div>
                    )}

                    {/* Biometric Measurements Grid */}
                    <div style={{
                      flex: 1,
                      minWidth: '240px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '0.75rem',
                      backgroundColor: '#ffffff',
                      padding: '1rem',
                      borderRadius: '12px',
                      border: '1px solid #ccfbf1'
                    }}>
                      {faceShape && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Face Shape</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>
                            {faceShape} {faceShapeConfidence ? `(${faceShapeConfidence}%)` : ''}
                          </div>
                        </div>
                      )}

                      {ipdMm && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Interpupillary (IPD)</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0284c7' }}>
                            {typeof ipdMm === 'number' ? ipdMm.toFixed(1) : ipdMm} mm
                          </div>
                        </div>
                      )}

                      {eyeShape && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Eye Shape</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                            {eyeShape}
                          </div>
                        </div>
                      )}

                      {faceWidthMm && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Face Width</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                            {faceWidthMm} mm
                          </div>
                        </div>
                      )}

                      {faceLengthMm && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Face Length</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                            {faceLengthMm} mm
                          </div>
                        </div>
                      )}

                      {skinTone && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Skin Tone</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                            {skinTone} {undertone ? `(${undertone})` : ''}
                          </div>
                        </div>
                      )}

                      {headCircumferenceCm && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Head Circumference</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                            {headCircumferenceCm} cm
                          </div>
                        </div>
                      )}

                      {eyeToEarMm && (
                        <div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Eye to Ear</div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                            {eyeToEarMm} mm
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '0.75rem 0', color: '#64748b', fontSize: '0.86rem' }}>
                    No face scan data available in this session yet. You can complete your appointment booking below, or take a quick 1-minute face scan to attach your facial measurements & face sketch for the doctor.
                  </div>
                )}

                <div style={{
                  fontSize: '0.74rem',
                  color: '#0f766e',
                  fontWeight: 600,
                  marginTop: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <ShieldCheck size={14} />
                  These measurements and the face sketch will be saved and transferred directly to your attending doctor before your appointment.
                </div>
              </div>

              {/* SECTION 3: FRAMES FOR DOORSTEP TRIAL (FROM MY COLLECTION) */}
              <div style={{
                marginBottom: '2rem',
                backgroundColor: '#ffffff',
                padding: '1.5rem',
                borderRadius: '18px',
                border: '1.5px solid #ccfbf1'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  marginBottom: '1rem'
                }}>
                  <h3 style={{
                    fontSize: '0.98rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <Glasses size={18} color="#0d9488" />
                    3. Select Frames for Doorstep Trial (from My Collection)
                  </h3>

                  {availablePicks.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={handleSelectAllFrames}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#0f766e',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: '2px 6px'
                        }}
                      >
                        Select All
                      </button>
                      <span style={{ color: '#cbd5e1' }}>•</span>
                      <button
                        type="button"
                        onClick={handleClearFrameSelection}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#64748b',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: '2px 6px'
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {loadingPicks ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                    Loading saved frames...
                  </div>
                ) : availablePicks.length === 0 ? (
                  <div style={{
                    padding: '1.5rem',
                    borderRadius: '14px',
                    backgroundColor: '#f8fafc',
                    border: '1px dashed #cbd5e1',
                    textAlign: 'center'
                  }}>
                    <Glasses size={32} color="#94a3b8" style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#334155' }}>
                      No frames saved in your collection yet
                    </div>
                    <p style={{ margin: '4px 0 12px', fontSize: '0.82rem', color: '#64748b', maxWidth: '440px', marginInline: 'auto' }}>
                      You can schedule your home visit right now, or explore our Optical Boutique to save frames to your EyeReach Collection so our representative brings them to your door.
                    </p>
                    {onOpenBoutique && (
                      <button
                        type="button"
                        onClick={onOpenBoutique}
                        style={{
                          backgroundColor: '#f0fdfa',
                          color: '#0f766e',
                          border: '1px solid #99f6e4',
                          padding: '0.55rem 1.2rem',
                          borderRadius: '10px',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Browse Optical Boutique & Add Frames to Collection
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '10px',
                      fontSize: '0.8rem',
                      color: '#475569'
                    }}>
                      <span>
                        Select the frames you want our representative to bring to your home:
                      </span>
                      <span style={{
                        backgroundColor: selectedFrameIds.size >= 1 && selectedFrameIds.size <= 10 ? '#ccfbf1' : '#fee2e2',
                        color: selectedFrameIds.size >= 1 && selectedFrameIds.size <= 10 ? '#115e59' : '#b91c1c',
                        padding: '3px 12px',
                        borderRadius: '999px',
                        fontWeight: 700,
                        fontSize: '0.76rem'
                      }}>
                        Selected: {selectedFrameIds.size} / 10 frames (Min 1, Max 10)
                      </span>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                      gap: '12px'
                    }}>
                      {availablePicks.map((pick) => {
                        const pickId = String(pick.product_id || pick.id);
                        const isSelected = selectedFrameIds.has(pickId);
                        return (
                          <div
                            key={pickId}
                            onClick={() => handleToggleFrameSelect(pickId)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '12px',
                              border: isSelected ? '2px solid #0d9488' : '1px solid #e2e8f0',
                              backgroundColor: isSelected ? '#f0fdfa' : '#ffffff',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              transition: 'all 0.15s',
                              boxShadow: isSelected ? '0 2px 8px rgba(13, 148, 136, 0.12)' : 'none'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              style={{ accentColor: '#0d9488', width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            {pick.front_image && (
                              <img
                                src={pick.front_image}
                                alt={pick.name}
                                style={{ width: '48px', height: '32px', objectFit: 'contain' }}
                              />
                            )}
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{
                                fontSize: '0.84rem',
                                fontWeight: 700,
                                color: isSelected ? '#0f766e' : '#0f172a',
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden'
                              }}>
                                {pick.name}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                {pick.shape} • {pick.color}
                              </div>
                              {pick.price && (
                                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#0f766e' }}>
                                  ₹{pick.price}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* SECTION 4: PATIENT & CONTACT DETAILS */}
              <div style={{
                marginBottom: '2rem',
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '18px',
                border: '1px solid #e2e8f0'
              }}>
                <h3 style={{
                  fontSize: '0.98rem',
                  fontWeight: 700,
                  color: '#1e293b',
                  margin: '0 0 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <User size={18} color="#0d9488" />
                  4. Patient & Doorstep Contact Details
                </h3>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '1rem'
                }}>
                  {/* Full Name */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Patient / Full Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Dr. Rajesh Sharma"
                        required
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.75rem 0.65rem 2.2rem',
                          borderRadius: '10px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.9rem',
                          backgroundColor: '#ffffff',
                          color: '#0f172a',
                          boxSizing: 'border-box',
                          outline: 'none'
                        }}
                      />
                      <User size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                    </div>
                  </div>

                  {/* Mobile Number */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Mobile Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="tel"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                        placeholder="e.g. 9876543210"
                        required
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.75rem 0.65rem 2.2rem',
                          borderRadius: '10px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.9rem',
                          backgroundColor: '#ffffff',
                          color: '#0f172a',
                          boxSizing: 'border-box',
                          outline: 'none'
                        }}
                      />
                      <Phone size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                    </div>
                  </div>

                  {/* Email Address */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Email Address <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="e.g. name@example.com"
                        required
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.75rem 0.65rem 2.2rem',
                          borderRadius: '10px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.9rem',
                          backgroundColor: '#ffffff',
                          color: '#0f172a',
                          boxSizing: 'border-box',
                          outline: 'none'
                        }}
                      />
                      <Mail size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                    </div>
                  </div>
                </div>

                {/* Home Address (Mandatory for Home Testing / Home Visit) */}
                <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Home Address for Doorstep Testing & Frame Trial <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <textarea
                      value={homeAddress}
                      onChange={(e) => setHomeAddress(e.target.value)}
                      placeholder="House / Flat No., Apartment / Building Name, Street, Landmark & PIN Code"
                      rows={3}
                      required
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.75rem 0.65rem 2.2rem',
                        borderRadius: '10px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                        backgroundColor: '#ffffff',
                        color: '#0f172a',
                        boxSizing: 'border-box',
                        outline: 'none',
                        resize: 'vertical'
                      }}
                    />
                    <MapPin size={16} color="#0d9488" style={{ position: 'absolute', left: '10px', top: '14px' }} />
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Our mobile optometrist will arrive at this address with your selected trial frames and testing equipment.
                  </span>
                </div>

                {/* Purpose of Home Visit */}
                <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Purpose of Home Visit <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.75rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      boxSizing: 'border-box',
                      outline: 'none'
                    }}
                  >
                    {PURPOSE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>

                  {purpose.includes('Custom') && (
                    <input
                      type="text"
                      value={customPurpose}
                      onChange={(e) => setCustomPurpose(e.target.value)}
                      placeholder="Please specify your testing or consultation request"
                      required
                      style={{
                        width: '100%',
                        marginTop: '8px',
                        padding: '0.6rem 0.75rem',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.88rem',
                        boxSizing: 'border-box'
                      }}
                    />
                  )}
                </div>

                {/* Additional Message */}
                <div style={{ marginTop: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Additional Notes / Health Symptoms <span style={{ color: '#94a3b8' }}>(Optional)</span>
                  </label>
                  <textarea
                    value={additionalMessage}
                    onChange={(e) => setAdditionalMessage(e.target.value)}
                    placeholder="Any specific symptoms, current frame details, or special requests..."
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.75rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.88rem',
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      boxSizing: 'border-box',
                      outline: 'none',
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>

              {/* SECTION 4: DATE & TIME SELECTION */}
              <div style={{
                marginBottom: '2rem',
                backgroundColor: '#ffffff',
                padding: '1.5rem',
                borderRadius: '18px',
                border: '1px solid #e2e8f0'
              }}>
                <h3 style={{
                  fontSize: '0.98rem',
                  fontWeight: 700,
                  color: '#1e293b',
                  margin: '0 0 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <Calendar size={18} color="#0d9488" />
                  4. Select Date and Time
                </h3>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '1.25rem'
                }}>
                  {/* Date Picker */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                      Select Date <span style={{ color: '#ef4444' }}>*</span> (No past dates)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="date"
                        min={todayISO}
                        value={appointmentDate}
                        onChange={(e) => setAppointmentDate(e.target.value)}
                        required
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.75rem 0.65rem 2.2rem',
                          borderRadius: '10px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.92rem',
                          backgroundColor: '#ffffff',
                          color: '#0f172a',
                          boxSizing: 'border-box',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      />
                      <Calendar size={16} color="#0284c7" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block', marginTop: '4px' }}>
                      Available for booking from today onward.
                    </span>
                  </div>

                  {/* Time Selector */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                      Select Time <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    
                    {/* Time Slot Buttons */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
                      gap: '8px',
                      marginBottom: '8px'
                    }}>
                      {TIME_SLOTS.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setAppointmentTime(slot)}
                          style={{
                            padding: '6px 8px',
                            borderRadius: '8px',
                            border: appointmentTime === slot ? '2px solid #0d9488' : '1px solid #e2e8f0',
                            backgroundColor: appointmentTime === slot ? '#ccfbf1' : '#f8fafc',
                            color: appointmentTime === slot ? '#0f766e' : '#334155',
                            fontWeight: appointmentTime === slot ? 700 : 500,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>

                    <div style={{ position: 'relative', marginTop: '6px' }}>
                      <input
                        type="text"
                        value={appointmentTime}
                        onChange={(e) => setAppointmentTime(e.target.value)}
                        placeholder="Or type custom time (e.g. 11:15 AM)"
                        style={{
                          width: '100%',
                          padding: '0.55rem 0.75rem 0.55rem 2.2rem',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.85rem',
                          backgroundColor: '#ffffff',
                          color: '#0f172a',
                          boxSizing: 'border-box'
                        }}
                      />
                      <Clock size={15} color="#0d9488" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                    </div>
                  </div>
                </div>

                {/* DATE & TIME SUMMARY PREVIEW */}
                <div style={{
                  marginTop: '1.25rem',
                  padding: '1rem',
                  borderRadius: '12px',
                  backgroundColor: '#f0fdfa',
                  border: '1px solid #99f6e4',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    backgroundColor: '#0d9488',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Calendar size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700, color: '#0f766e', letterSpacing: '0.04em' }}>
                      Date & Time Summary
                    </div>
                    <div style={{ fontSize: '0.94rem', fontWeight: 700, color: '#134e4a' }}>
                      {getFormattedDateSummary(appointmentDate)} {appointmentDate && appointmentTime ? `• at ${appointmentTime}` : ''}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#0f766e', marginTop: '2px' }}>
                      Type: <strong>Home Testing / Home Visit Appointment</strong> (Doorstep Frame Trial & Vision Check)
                    </div>
                  </div>
                </div>
              </div>

              {/* Error Alert */}
              {errorMessage && (
                <div style={{
                  marginBottom: '1.5rem',
                  padding: '0.85rem 1rem',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '12px',
                  color: '#b91c1c',
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <AlertCircle size={18} style={{ flexShrink: 0 }} />
                  <div>{errorMessage}</div>
                </div>
              )}

              {/* SECTION 5: FORM BUTTONS */}
              <div style={{
                display: 'flex',
                gap: '14px',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingTop: '0.5rem'
              }}>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={submitting}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: '#ffffff',
                    color: '#64748b',
                    border: '1px solid #cbd5e1',
                    padding: '0.75rem 1.4rem',
                    borderRadius: '12px',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <RotateCcw size={16} />
                  Reset Form
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.8rem 2rem',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 14px rgba(2, 132, 199, 0.3)',
                    transition: 'all 0.2s',
                    opacity: submitting ? 0.7 : 1
                  }}
                >
                  {submitting ? (
                    <>
                      <span className="spinner" style={{
                        display: 'inline-block',
                        width: '16px',
                        height: '16px',
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderRadius: '50%',
                        borderTopColor: '#ffffff',
                        animation: 'spin 0.8s linear infinite'
                      }} />
                      Submitting Appointment...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={18} />
                      Submit Appointment
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>
        )}
      </main>
    </div>
  );
}
