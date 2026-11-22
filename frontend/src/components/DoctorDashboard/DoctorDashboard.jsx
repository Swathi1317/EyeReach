import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Stethoscope,
  Calendar,
  Clock,
  User,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Glasses,
  FileText,
  Check,
  Eye,
  Activity,
  LogOut,
  Filter,
  RefreshCw,
  ShieldCheck,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { EyeReachLogo } from '../AuthPage';

export default function DoctorDashboard({ doctorUser, onLogout }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'Pending' | 'Confirmed' | 'Rejected'
  const [expandedAppointmentId, setExpandedAppointmentId] = useState(null);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [doctorNotesDrafts, setDoctorNotesDrafts] = useState({});
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null);

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('smartframe_token');
      const res = await axios.get('/api/doctor/appointments', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAppointments(res.data.appointments || []);
    } catch (err) {
      console.error('Error fetching doctor appointments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, []);

  const handleUpdateStatus = async (appointmentId, newStatus) => {
    setActionLoadingId(appointmentId);
    setActionSuccessMsg(null);
    try {
      const token = localStorage.getItem('smartframe_token');
      const notes = doctorNotesDrafts[appointmentId] || '';
      await axios.put(
        `/api/doctor/appointments/${appointmentId}/status`,
        { status: newStatus, doctor_notes: notes },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setActionSuccessMsg(`Appointment #${appointmentId} has been marked as ${newStatus}.`);
      fetchAppointments();
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to update appointment status.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredAppointments = appointments.filter((app) => {
    if (activeFilter === 'all') return true;
    return (app.status || 'Pending').toLowerCase() === activeFilter.toLowerCase();
  });

  const pendingCount = appointments.filter((a) => (a.status || 'Pending').toLowerCase() === 'pending').length;
  const confirmedCount = appointments.filter((a) => (a.status || '').toLowerCase() === 'confirmed').length;
  const rejectedCount = appointments.filter((a) => (a.status || '').toLowerCase() === 'rejected').length;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Professional Doctor Header */}
      <header style={{
        backgroundColor: '#064e3b',
        color: '#ffffff',
        padding: '0.85rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        boxShadow: '0 2px 10px rgba(6, 78, 59, 0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <EyeReachLogo size={42} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>EyeReach</span>
              <span style={{
                backgroundColor: '#10b981',
                color: '#ffffff',
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.04em'
              }}>
                DOCTOR PORTAL
              </span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#a7f3d0' }}>
              Clinical Optometry & Home Visit Review Console
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
              {doctorUser?.name || 'Dr. Priya Nair'}
            </div>
            <div style={{ fontSize: '0.74rem', color: '#a7f3d0' }}>
              {doctorUser?.qualification || 'M.Optom, FAAO'} • Reg: {doctorUser?.registration_number || 'KA-OPT-2019-8821'}
            </div>
          </div>

          <button
            onClick={onLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              color: '#ffffff',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.75rem 1.25rem' }}>
        {/* Doctor Summary Banner */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.03)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Stethoscope size={22} color="#059669" />
              <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                Assigned Home Visit Appointments
              </h1>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: '#64748b' }}>
              Review customer prescriptions, biometric face scan analyses, and prepare selected spectacle frames before home visit approval.
            </p>
          </div>

          <button
            onClick={fetchAppointments}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#334155',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            <span>Refresh Appointments</span>
          </button>
        </div>

        {/* Success Alert */}
        {actionSuccessMsg && (
          <div style={{
            backgroundColor: '#dcfce7',
            border: '1px solid #86efac',
            color: '#15803d',
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            marginBottom: '1.25rem',
            fontWeight: 700,
            fontSize: '0.90rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <CheckCircle2 size={18} />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {/* Metric Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.75rem'
        }}>
          <div
            onClick={() => setActiveFilter('all')}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: `2px solid ${activeFilter === 'all' ? '#059669' : '#e2e8f0'}`,
              padding: '1.1rem',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}
          >
            <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Total Assigned</div>
            <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#0f172a', margin: '4px 0' }}>
              {appointments.length}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>All home appointments</div>
          </div>

          <div
            onClick={() => setActiveFilter('Pending')}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: `2px solid ${activeFilter === 'Pending' ? '#d97706' : '#e2e8f0'}`,
              padding: '1.1rem',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}
          >
            <div style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 700 }}>⏳ Pending Clinical Review</div>
            <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#d97706', margin: '4px 0' }}>
              {pendingCount}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600 }}>Requires approval/rejection</div>
          </div>

          <div
            onClick={() => setActiveFilter('Confirmed')}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: `2px solid ${activeFilter === 'Confirmed' ? '#059669' : '#e2e8f0'}`,
              padding: '1.1rem',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}
          >
            <div style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 700 }}>✓ Confirmed for Visit</div>
            <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#166534', margin: '4px 0' }}>
              {confirmedCount}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 600 }}>Approved home visits</div>
          </div>

          <div
            onClick={() => setActiveFilter('Rejected')}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: `2px solid ${activeFilter === 'Rejected' ? '#dc2626' : '#e2e8f0'}`,
              padding: '1.1rem',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}
          >
            <div style={{ fontSize: '0.78rem', color: '#991b1b', fontWeight: 700 }}>✕ Rejected / Ineligible</div>
            <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#dc2626', margin: '4px 0' }}>
              {rejectedCount}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600 }}>Declined appointments</div>
          </div>
        </div>

        {/* Filter Navigation Pills */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All (${appointments.length})` },
            { id: 'Pending', label: `Pending Review (${pendingCount})` },
            { id: 'Confirmed', label: `Confirmed (${confirmedCount})` },
            { id: 'Rejected', label: `Rejected (${rejectedCount})` }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeFilter === tab.id ? '#064e3b' : '#ffffff',
                color: activeFilter === tab.id ? '#ffffff' : '#475569',
                fontSize: '0.84rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Appointments List */}
        {loading ? (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '3rem',
            textAlign: 'center',
            color: '#64748b'
          }}>
            Loading assigned doctor appointments...
          </div>
        ) : filteredAppointments.length === 0 ? (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '3rem',
            textAlign: 'center',
            color: '#64748b',
            border: '1px solid #e2e8f0'
          }}>
            <Calendar size={36} color="#cbd5e1" style={{ marginBottom: '8px' }} />
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              No appointments found in this category
            </div>
            <div style={{ fontSize: '0.84rem', marginTop: '4px' }}>
              When customers book home visit trials or face scans, they will appear here for your review.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {filteredAppointments.map((app) => {
              const isExpanded = expandedAppointmentId === app.id;
              const statusStr = app.status || 'Pending';
              const isPending = statusStr.toLowerCase() === 'pending';
              const isConfirmed = statusStr.toLowerCase() === 'confirmed';
              const isRejected = statusStr.toLowerCase() === 'rejected';

              const selectedFrames = app.selected_frames || [];
              const faceAnalysis = app.face_analysis || {};

              return (
                <div
                  key={app.id}
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '14px',
                    border: isPending ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                    overflow: 'hidden',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.03)'
                  }}
                >
                  {/* Card Header */}
                  <div style={{
                    padding: '1.1rem 1.4rem',
                    backgroundColor: isPending ? '#fffbeb' : '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#0f172a',
                        color: '#ffffff',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        letterSpacing: '0.04em'
                      }}>
                        {app.appointment_id || `APP-${app.id}`}
                      </span>

                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        backgroundColor: isConfirmed ? '#dcfce7' : isRejected ? '#fee2e2' : '#fef3c7',
                        color: isConfirmed ? '#15803d' : isRejected ? '#b91c1c' : '#b45309'
                      }}>
                        {isConfirmed && <CheckCircle2 size={14} />}
                        {isRejected && <XCircle size={14} />}
                        {isPending && <Clock size={14} />}
                        <span>Status: {statusStr}</span>
                      </span>

                      <span style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                        📅 {app.appointment_date} at {app.appointment_time}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        onClick={() => setExpandedAppointmentId(isExpanded ? null : app.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#ffffff',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: '#334155',
                          cursor: 'pointer'
                        }}
                      >
                        <span>{isExpanded ? 'Collapse Details' : 'View Full Patient File'}</span>
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* Card Main Body */}
                  <div style={{ padding: '1.25rem 1.4rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
                      {/* Customer Info */}
                      <div>
                        <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '4px' }}>
                          Customer / Patient
                        </div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                          {app.full_name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '0.84rem', color: '#334155' }}>
                          <Phone size={15} color="#059669" />
                          <a href={`tel:${app.mobile_number}`} style={{ color: '#059669', fontWeight: 700, textDecoration: 'none' }}>
                            {app.mobile_number}
                          </a>
                        </div>
                        {app.email && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', fontSize: '0.80rem', color: '#64748b' }}>
                            <Mail size={14} />
                            <span>{app.email}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '6px', fontSize: '0.82rem', color: '#475569' }}>
                          <MapPin size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                          <span>{app.home_address || 'Address unlisted'}</span>
                        </div>
                      </div>

                      {/* Home Visit Purpose & Notes */}
                      <div>
                        <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '4px' }}>
                          Home Visit Purpose
                        </div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
                          {app.purpose || 'Doorstep Spectacle Trial & Frame Fitting Verification'}
                        </div>
                        {app.additional_message && (
                          <div style={{ marginTop: '6px', fontSize: '0.80rem', color: '#64748b', backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '6px' }}>
                            <strong>Customer Note:</strong> {app.additional_message}
                          </div>
                        )}
                        {app.doctor_notes && (
                          <div style={{ marginTop: '6px', fontSize: '0.80rem', color: '#065f46', backgroundColor: '#ecfdf5', padding: '6px 10px', borderRadius: '6px', border: '1px solid #a7f3d0' }}>
                            <strong>Doctor Clinical Notes:</strong> {app.doctor_notes}
                          </div>
                        )}
                      </div>

                      {/* Quick Frames Summary */}
                      <div>
                        <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '4px' }}>
                          Spectacle Frames Selected for Home Trial
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Glasses size={18} color="#0d9488" />
                          <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#0d9488' }}>
                            {selectedFrames.length} Frames Selected
                          </span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                          Bring these {selectedFrames.length} frames for physical doorstep fitting.
                        </div>

                        {/* Quick preview frame thumbnails */}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                          {selectedFrames.slice(0, 5).map((f, i) => (
                            <img
                              key={i}
                              src={f.front_image}
                              alt={f.name || 'Frame'}
                              title={`${f.name} (${f.shape || ''})`}
                              style={{ width: '46px', height: '30px', objectFit: 'contain', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}
                              onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                            />
                          ))}
                          {selectedFrames.length > 5 && (
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', alignSelf: 'center' }}>
                              +{selectedFrames.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* EXPANDED DETAILS: Clinical Biometrics & Full Frames Table */}
                    {isExpanded && (
                      <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px dashed #cbd5e1' }}>
                        {/* Clinical Face Scan Biometrics */}
                        <div style={{
                          backgroundColor: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: '10px',
                          padding: '1rem',
                          marginBottom: '1.25rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <Activity size={18} color="#16a34a" />
                            <strong style={{ fontSize: '0.90rem', color: '#166534' }}>
                              Clinical Facial Biometrics (From EyeReach Face Scan)
                            </strong>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', fontSize: '0.82rem' }}>
                            <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                              <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Face Shape:</span>
                              <div style={{ fontWeight: 800, color: '#0f172a' }}>{faceAnalysis.face_shape || 'Evaluated'}</div>
                            </div>
                            <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                              <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Pupillary Distance (IPD):</span>
                              <div style={{ fontWeight: 800, color: '#059669' }}>
                                {faceAnalysis.ipd_mm ? `${Number(faceAnalysis.ipd_mm).toFixed(1)} mm` : 'Calibrated'}
                              </div>
                            </div>
                            <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                              <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Face Width (Cheekbone):</span>
                              <div style={{ fontWeight: 800, color: '#0f172a' }}>
                                {faceAnalysis.face_width_mm ? `${Number(faceAnalysis.face_width_mm).toFixed(1)} mm` : 'Standard'}
                              </div>
                            </div>
                            <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                              <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Head Circumference:</span>
                              <div style={{ fontWeight: 800, color: '#0f172a' }}>
                                {faceAnalysis.head_circumference_cm ? `${Number(faceAnalysis.head_circumference_cm).toFixed(1)} cm` : 'Medium'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Full Attached Frames Grid */}
                        <div style={{ marginBottom: '1.25rem' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
                            👓 Selected Spectacle Frames to Carry ({selectedFrames.length} items):
                          </div>

                          {selectedFrames.length === 0 ? (
                            <div style={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
                              No specific frames pre-selected. Carry standard multi-style optometrist kit.
                            </div>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px' }}>
                              {selectedFrames.map((f, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '8px',
                                    padding: '8px',
                                    backgroundColor: '#ffffff',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px'
                                  }}
                                >
                                  <div style={{ height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '6px' }}>
                                    <img
                                      src={f.front_image}
                                      alt={f.name}
                                      style={{ maxWidth: '90%', maxHeight: '80%', objectFit: 'contain' }}
                                      onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                                    />
                                  </div>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {f.name}
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                                    {f.brand} • {f.shape} • {f.color}
                                  </div>
                                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#059669', marginTop: 'auto' }}>
                                    {f.price ? `₹${f.price}` : 'Trial Spec'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Doctor Notes Input Field */}
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                            Add Clinical Notes / Pre-visit Instructions:
                          </label>
                          <textarea
                            rows="2"
                            placeholder="e.g. Verified IPD with 62mm frame bridge. Pack progressive lenses trial set..."
                            value={doctorNotesDrafts[app.id] ?? (app.doctor_notes || '')}
                            onChange={(e) => setDoctorNotesDrafts({ ...doctorNotesDrafts, [app.id]: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              fontSize: '0.82rem',
                              fontFamily: 'inherit',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* DOCTOR ACTION BUTTONS (Requirement 3 & 4) */}
                    <div style={{
                      marginTop: '1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '10px',
                      flexWrap: 'wrap'
                    }}>
                      {/* Approve Button -> Confirmed */}
                      <button
                        onClick={() => handleUpdateStatus(app.id, 'Confirmed')}
                        disabled={actionLoadingId === app.id || isConfirmed}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: isConfirmed ? '#94a3b8' : '#059669',
                          color: '#ffffff',
                          fontSize: '0.85rem',
                          fontWeight: 800,
                          cursor: isConfirmed ? 'not-allowed' : 'pointer',
                          boxShadow: '0 2px 4px rgba(5, 150, 105, 0.2)'
                        }}
                      >
                        <CheckCircle2 size={16} />
                        <span>{isConfirmed ? 'Appointment Confirmed' : 'Approve Appointment (Confirm Visit)'}</span>
                      </button>

                      {/* Reject Button -> Rejected */}
                      <button
                        onClick={() => handleUpdateStatus(app.id, 'Rejected')}
                        disabled={actionLoadingId === app.id || isRejected}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: '1px solid #fecaca',
                          backgroundColor: isRejected ? '#f1f5f9' : '#fee2e2',
                          color: isRejected ? '#94a3b8' : '#b91c1c',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: isRejected ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <XCircle size={16} />
                        <span>{isRejected ? 'Appointment Rejected' : 'Reject Appointment'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
