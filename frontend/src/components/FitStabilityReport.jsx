import React from 'react';

export default function FitStabilityReport({ report, frame, onRetake, onClose }) {
  if (!report || !report.sections) return null;

  const {
    front_fit,
    nose_bridge_alignment,
    right_temple_fit,
    left_temple_fit,
    head_down_movement,
    overall_assessment
  } = report.sections;

  const dimensionComparison = report.dimension_comparison || report.sections?.frame_dimension_comparison;

  // Compute 6 Compact Automatic Fit Summary metrics
  const frameWidthStatus = (() => {
    const s = (front_fit?.status || '').toLowerCase();
    if (s.includes('loose') || s.includes('wide')) return 'Wide';
    if (s.includes('tight') || s.includes('narrow')) return 'Narrow';
    return 'Good';
  })();

  const bridgeFitStatus = (() => {
    const s = (nose_bridge_alignment?.status || '').toLowerCase();
    if (s.includes('concern') || s.includes('misaligned')) return 'Misaligned';
    return 'Good';
  })();

  const leftTempleStatus = (() => {
    const s = (left_temple_fit?.status || '').toLowerCase();
    if (s.includes('unable') || s.includes('insufficient')) return 'Not Verified';
    return 'Aligned';
  })();

  const rightTempleStatus = (() => {
    const s = (right_temple_fit?.status || '').toLowerCase();
    if (s.includes('unable') || s.includes('insufficient')) return 'Not Verified';
    return 'Aligned';
  })();

  const visualAlignmentStatus = (() => {
    const s = (overall_assessment?.status || '').toLowerCase();
    if (s.includes('concern') || s.includes('unable')) return 'Needs Adjustment';
    return 'Good';
  })();

  const overallResult = (() => {
    const s = (overall_assessment?.status || '').toLowerCase();
    if (s.includes('aligned')) return 'Optimal';
    if (s.includes('loose') || s.includes('concern')) return 'Check Fit';
    return 'Acceptable';
  })();

  const getStatusClass = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('aligned')) return 'status-aligned';
    if (s.includes('loose')) return 'status-loose';
    if (s.includes('concern')) return 'status-concern';
    if (s.includes('insufficient')) return 'status-insufficient';
    return 'status-unable';
  };

  const cards = [
    { 
      key: 'R_PROFILE', 
      title: 'Right-Side Profile Measurements', 
      data: right_temple_fit, 
      icon: '📐',
      customNote: right_temple_fit?.measurements?.eye_to_ear_distance_mm 
        ? `Calibrated Hinge-to-Ear: ${right_temple_fit.measurements.eye_to_ear_distance_mm} mm (Required temple reach: ~${right_temple_fit.measurements.estimated_required_temple_mm} mm)`
        : 'Scale uncalibrated; straight-line pixel geometry estimated.'
    },
    { 
      key: 'L_PROFILE', 
      title: 'Left-Side Profile Measurements', 
      data: left_temple_fit, 
      icon: '📐',
      customNote: left_temple_fit?.measurements?.eye_to_ear_distance_mm 
        ? `Calibrated Hinge-to-Ear: ${left_temple_fit.measurements.eye_to_ear_distance_mm} mm (Required temple reach: ~${left_temple_fit.measurements.estimated_required_temple_mm} mm)`
        : 'Scale uncalibrated; straight-line pixel geometry estimated.'
    },
    { 
      key: 'NOSE_BRIDGE', 
      title: 'Nose Bridge Alignment', 
      data: nose_bridge_alignment, 
      icon: '👃',
      customNote: 'Tracks bridge seating across nasal crest and vertical stability.'
    },
    { 
      key: 'R_TEMPLE', 
      title: 'Right Temple / Ear Alignment', 
      data: right_temple_fit, 
      icon: '👂',
      customNote: 'Evaluates temple arm trajectory from lateral orbital rim toward superior ear junction.'
    },
    { 
      key: 'L_TEMPLE', 
      title: 'Left Temple / Ear Alignment', 
      data: left_temple_fit, 
      icon: '👂',
      customNote: 'Evaluates temple arm trajectory and checks bilateral cranial balance.'
    },
    { 
      key: 'HEAD_DOWN', 
      title: 'Head-Down Movement Observations', 
      data: head_down_movement, 
      icon: '🔄',
      customNote: 'Measures simulated vertical displacement and return-to-center fidelity.'
    },
    { 
      key: 'OVERALL', 
      title: 'Overall Visual Fit Assessment', 
      data: overall_assessment, 
      icon: '🎯',
      customNote: 'Synthesis of bilateral temple vectors, bridge fit, and alignment observations.'
    }
  ];

  return (
    <div className="fit-stability-report-overlay">
      <div className="fit-stability-report-modal">
        {/* Header */}
        <div className="fit-report-header">
          <div>
            <div className="fit-report-badge">REAL-TIME SIDE PROFILE & FRAME FIT</div>
            <h2 className="fit-report-title">Real-Time Eyewear Fit Analysis</h2>
            <p className="fit-report-subtitle">
              Evaluating side-profile measurements and actual frame dimensions for <strong>{frame?.name || report.frame_name || 'Selected Frame'}</strong>
            </p>
          </div>
          <div className="fit-report-actions">
            {onRetake && (
              <button onClick={onRetake} className="btn-secondary-action">
                ↺ Retake Analysis
              </button>
            )}
            {onClose && (
              <button onClick={onClose} className="btn-close-action">
                ✕ Close
              </button>
            )}
          </div>
        </div>

        {/* COMPACT AUTOMATIC FIT SUMMARY (Priority 4) */}
        <div style={{
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '12px',
          padding: '1.25rem',
          marginBottom: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              📋 Simple Automatic Fit Summary
            </span>
            <span style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '4px 12px',
              borderRadius: '20px',
              background: overallResult === 'Optimal' ? '#dcfce7' : overallResult === 'Acceptable' ? '#e0f2fe' : '#fef3c7',
              color: overallResult === 'Optimal' ? '#15803d' : overallResult === 'Acceptable' ? '#0369a1' : '#b45309'
            }}>
              Overall Visual Fit: {overallResult}
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.75rem'
          }}>
            <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Frame Width</div>
              <div style={{ fontSize: '0.98rem', fontWeight: 700, color: frameWidthStatus === 'Good' ? '#15803d' : '#b45309', marginTop: '2px' }}>
                {frameWidthStatus}
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Bridge Fit</div>
              <div style={{ fontSize: '0.98rem', fontWeight: 700, color: bridgeFitStatus === 'Good' ? '#15803d' : '#b45309', marginTop: '2px' }}>
                {bridgeFitStatus}
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Left Temple</div>
              <div style={{ fontSize: '0.98rem', fontWeight: 700, color: leftTempleStatus === 'Aligned' ? '#15803d' : '#64748b', marginTop: '2px' }}>
                {leftTempleStatus}
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Right Temple</div>
              <div style={{ fontSize: '0.98rem', fontWeight: 700, color: rightTempleStatus === 'Aligned' ? '#15803d' : '#64748b', marginTop: '2px' }}>
                {rightTempleStatus}
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Visual Alignment</div>
              <div style={{ fontSize: '0.98rem', fontWeight: 700, color: visualAlignmentStatus === 'Good' ? '#15803d' : '#b45309', marginTop: '2px' }}>
                {visualAlignmentStatus}
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Overall Visual Fit</div>
              <div style={{ fontSize: '0.98rem', fontWeight: 700, color: overallResult === 'Optimal' ? '#15803d' : overallResult === 'Acceptable' ? '#0369a1' : '#b45309', marginTop: '2px' }}>
                {overallResult}
              </div>
            </div>
          </div>
        </div>

        {/* Essential Physical Limitation Disclaimer */}
        <div className="fit-disclaimer-box">
          <div className="fit-disclaimer-icon">ℹ️</div>
          <div>
            <strong>Visual Simulation Notice:</strong>
            <p>
              This is a camera-based visual fit-assessment feature. An ordinary webcam cannot measure
              physical comfort, skin contact pressure, temple clamp force, or guarantee retention during strenuous activity.
            </p>
          </div>
        </div>

        {/* Actual Frame Dimensions vs User Measurements Table */}
        {dimensionComparison && (
          <div className="fit-dimension-comparison-card">
            <div className="fit-dimension-header">
              <span className="fit-dimension-icon">📏</span>
              <strong>Actual Frame Dimensions vs. Measured Profile</strong>
            </div>
            <div className="fit-dimension-table-wrapper">
              <table className="fit-dimension-table">
                <thead>
                  <tr>
                    <th>Dimension</th>
                    <th>Catalog Specification</th>
                    <th>User Calibrated Measurement</th>
                    <th>Fit Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(dimensionComparison).map(([key, item]) => {
                    const statusClass = getStatusClass(item.status);
                    return (
                      <tr key={key}>
                        <td><strong>{item.dimension_name}</strong></td>
                        <td>
                          {item.catalog_value_mm !== null && item.catalog_value_mm !== undefined
                            ? `${item.catalog_value_mm} mm`
                            : key === 'temple_length'
                            ? <span className="text-insufficient">Temple Length Unavailable</span>
                            : <span className="text-insufficient">Not available in dataset</span>}
                        </td>
                        <td>
                          {item.user_measured_mm !== null && item.user_measured_mm !== undefined
                            ? `${item.user_measured_mm} mm`
                            : <span className="text-uncalibrated">Calibration unavailable</span>}
                        </td>
                        <td>
                          <span className={`fit-status-badge ${statusClass}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="fit-dimension-footer">
              * Note: Temple arm length accounts for the 3D arc curving over the ear apex (~1.30–1.35× direct projection) rather than simple straight-line distance.
            </div>
          </div>
        )}

        {/* 6+ Sections Grid */}
        <div className="fit-sections-grid">
          {cards.map(({ key, title, data, icon, customNote }) => {
            if (!data) return null;
            const statusClass = getStatusClass(data.status);
            const isOverall = key === 'OVERALL';

            return (
              <div key={key} className={`fit-section-card ${isOverall ? 'fit-overall-card' : ''}`}>
                <div className="fit-section-card-header">
                  <div className="fit-section-card-title">
                    <span className="fit-card-icon">{icon}</span>
                    <span>{title}</span>
                  </div>
                  <span className={`fit-status-badge ${statusClass}`}>
                    {data.status || 'Unable to Assess'}
                  </span>
                </div>

                {/* Observation */}
                <div className="fit-section-observation">
                  <strong>Observation:</strong> {data.observation}
                </div>

                {customNote && (
                  <div className="fit-custom-note">
                    <span className="note-bullet">▸</span> {customNote}
                  </div>
                )}

                {/* Metadata Row */}
                <div className="fit-meta-row">
                  <div className="fit-meta-item">
                    <span className="fit-meta-label">Confidence:</span>
                    <span className={`fit-confidence-pill confidence-${(data.confidence || 'low').toLowerCase()}`}>
                      {data.confidence || 'Moderate'}
                    </span>
                  </div>

                  {data.measurements && Object.keys(data.measurements).length > 0 && (
                    <div className="fit-meta-measurements">
                      {Object.entries(data.measurements).map(([k, v]) => {
                        if (v === null || v === undefined) return null;
                        const label = k.replace(/_/g, ' ').replace('mm', '(mm)').replace('deg', '(°)');
                        return (
                          <span key={k} className="fit-meas-pill">
                            {label}: <strong>{v}</strong>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Data Available / Missing */}
                <div className="fit-data-tracking">
                  {data.data_available && data.data_available.length > 0 && (
                    <div className="fit-data-available">
                      <span className="fit-data-label">Available:</span>
                      {data.data_available.map((d, i) => (
                        <span key={i} className="data-pill available">✓ {d}</span>
                      ))}
                    </div>
                  )}

                  {data.data_missing && data.data_missing.length > 0 && (
                    <div className="fit-data-missing">
                      <span className="fit-data-label">Missing metadata:</span>
                      {data.data_missing.map((d, i) => (
                        <span key={i} className="data-pill missing">✕ {d}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Possible Fit Concern */}
                {data.possible_fit_concern && (
                  <div className="fit-concern-alert">
                    <span className="concern-icon">⚠️</span>
                    <div>
                      <strong>Possible Fit Concern:</strong> {data.possible_fit_concern}
                    </div>
                  </div>
                )}

                {/* Suggested Next Step */}
                {data.suggested_next_step && (
                  <div className="fit-next-step">
                    <span className="next-step-icon">💡</span>
                    <div>
                      <strong>Suggested Next Step:</strong> {data.suggested_next_step}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
