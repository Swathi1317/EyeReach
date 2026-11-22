import React from 'react';
import { X, TrendingUp, DollarSign, Target, Award, PieChart, Building, ShieldCheck, CheckCircle } from 'lucide-react';

export default function BusinessModelModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '1.25rem'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '920px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        border: '1px solid #e2e8f0'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem 2rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0f172a, #1e293b)',
          color: '#ffffff',
          borderRadius: '16px 16px 0 0'
        }}>
          <div>
            <div style={{
              display: 'inline-block',
              padding: '0.25rem 0.75rem',
              borderRadius: '20px',
              backgroundColor: 'rgba(217, 119, 6, 0.2)',
              color: '#fbbf24',
              fontSize: '0.75rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.4rem'
            }}>
              Module 11 & 12 • Executive Pitch Analysis
            </div>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
              EyeReach – Home Testing App: Business Model & Market Analysis
            </h2>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.88rem', color: '#94a3b8' }}>
              B2B Optical Store Enablement, Revenue Streams, and Optical Retail Market Sizing
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '8px',
              padding: '0.5rem',
              color: '#ffffff',
              cursor: 'pointer'
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '2rem' }}>

          {/* SECTION 1: MODULE 11 - B2B BUSINESS MODEL */}
          <div style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
              <Building size={22} color="#0d7665" />
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Module 11: B2B Optical Store SaaS Business Model
              </h3>
            </div>
            <p style={{ color: '#475569', fontSize: '0.92rem', lineHeight: 1.5, marginTop: 0 }}>
              EyeReach – Home Testing App operates on a hybrid <strong>B2B SaaS + Marketplace enablement</strong> model, empowering independent opticians and optical chains to offer digital biometric fitting and omnichannel sales without high capital expenditure.
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1rem',
              marginTop: '1.25rem'
            }}>
              {/* Stream 1 */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '1.25rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                  <DollarSign size={20} color="#0d7665" />
                  <strong style={{ color: '#0f172a', fontSize: '1rem' }}>Store Subscription Tiers</strong>
                </div>
                <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.2rem', color: '#475569', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  <li><strong>Free Starter:</strong> Up to 30 frames, basic 2D fit analysis, single user.</li>
                  <li><strong>Pro Store (₹1,999/mo):</strong> Unlimited products, bulk Excel upload, AI descriptions, 3D Try-On.</li>
                  <li><strong>Enterprise (₹4,999/mo):</strong> Multi-outlet inventory sync, in-store kiosk mode, dedicated API access.</li>
                </ul>
              </div>

              {/* Stream 2 */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '1.25rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                  <TrendingUp size={20} color="#0284c7" />
                  <strong style={{ color: '#0f172a', fontSize: '1rem' }}>Order Commission (3-5%)</strong>
                </div>
                <p style={{ color: '#475569', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
                  Take rate on customer orders generated via the customer discovery boutique and virtual try-on portal. Opticians fulfill the frames and lenses while EyeReach – Home Testing App handles biometric matching.
                </p>
              </div>

              {/* Stream 3 */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '1.25rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                  <Award size={20} color="#d97706" />
                  <strong style={{ color: '#0f172a', fontSize: '1rem' }}>Premium AI Credits</strong>
                </div>
                <p style={{ color: '#475569', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
                  Usage-based pricing for AI Frame Image Generation (Text-to-Image CAD design) and automated lens prescription OCR extraction for custom eyewear manufacturing.
                </p>
              </div>
            </div>
          </div>
        </div>

        </div>

        {/* Footer */}
        <div style={{
          padding: '1.25rem 2rem',
          borderTop: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'flex-end',
          borderRadius: '0 0 16px 16px'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#0f172a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: 'pointer'
            }}
          >
            Close Presentation
          </button>
        </div>
      </div>
    </div>
  );
}
