import React, { useState } from 'react';
import { X, RotateCw, Check, ShoppingBag, Eye, Store, Phone, MapPin, Sparkles } from 'lucide-react';
import axios from 'axios';

export default function ProductDetailModal({ product, isOpen, onClose, onTryOn, onOrderSuccess }) {
  const [activeAngle, setActiveAngle] = useState('front'); // 'front' | 'angled' | 'side'
  const [isRotating, setIsRotating] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderMessage, setOrderMessage] = useState(null);

  if (!isOpen || !product) return null;

  const angles = [
    { key: 'front', label: 'Front View (0°)', img: product.front_image },
    { key: 'angled', label: 'Perspective (45°)', img: product.angled_image || product.front_image },
    { key: 'side', label: 'Side Profile (90°)', img: product.side_image || product.front_image }
  ];

  const handleNextAngle = () => {
    setIsRotating(true);
    setTimeout(() => {
      setActiveAngle((prev) => {
        if (prev === 'front') return 'angled';
        if (prev === 'angled') return 'side';
        return 'front';
      });
      setIsRotating(false);
    }, 180);
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (!customerName || !customerPhone) {
      setOrderMessage({ type: 'error', text: 'Please enter your name and phone number.' });
      return;
    }

    setOrderLoading(true);
    setOrderMessage(null);
    try {
      const res = await axios.post('/api/customer/orders', {
        product_id: product.id,
        quantity: parseInt(quantity) || 1,
        customer_name: customerName,
        customer_phone: customerPhone
      });

      setOrderMessage({ type: 'success', text: res.data.message });
      setTimeout(() => {
        if (onOrderSuccess) onOrderSuccess();
      }, 1500);
    } catch (err) {
      setOrderMessage({
        type: 'error',
        text: err.response?.data?.detail || 'Failed to place order. Please try again.'
      });
    } finally {
      setOrderLoading(false);
    }
  };

  const activeImg = angles.find((a) => a.key === activeAngle)?.img || product.front_image;

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
      padding: '1rem'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '840px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        border: '1px solid #e2e8f0'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc',
          borderRadius: '16px 16px 0 0'
        }}>
          <div>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: '#e0f2fe',
              color: '#0369a1',
              textTransform: 'uppercase'
            }}>
              {product.brand} • {product.gender_category || 'Unisex'}
            </span>
            <h2 style={{ margin: '0.35rem 0 0 0', fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
              {product.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#e2e8f0',
              border: 'none',
              borderRadius: '8px',
              padding: '0.4rem',
              cursor: 'pointer',
              color: '#475569'
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          
          {/* Left Column: MODULE 9 - 360° / MULTI-ANGLE STUDIO VIEWER */}
          <div>
            <div style={{
              background: '#f8fafc',
              border: '2px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.5rem',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '260px'
            }}>
              {/* Honest 360° labeling per user requirement */}
              <div style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#ffffff',
                fontSize: '0.70rem',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '6px'
              }}>
                Studio Multi-Angle View
              </div>

              {/* Rotate Button */}
              <button
                onClick={handleNextAngle}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '20px',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#0f172a',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }}
              >
                <RotateCw size={12} />
                Rotate View
              </button>

              <img
                src={activeImg}
                alt={product.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '190px',
                  objectFit: 'contain',
                  transition: 'transform 0.25s ease, opacity 0.2s ease',
                  opacity: isRotating ? 0.3 : 1,
                  transform: isRotating ? 'scale(0.95)' : 'scale(1)'
                }}
                onError={(e) => {
                  e.target.src = '/frames/frame_001.svg';
                }}
              />

              <div style={{
                marginTop: '1rem',
                fontSize: '0.80rem',
                color: '#64748b',
                fontWeight: 600
              }}>
                {angles.find((a) => a.key === activeAngle)?.label}
              </div>
            </div>

            {/* Angle Selector Thumbnails */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '0.75rem' }}>
              {angles.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setActiveAngle(a.key)}
                  style={{
                    flex: 1,
                    padding: '0.45rem',
                    borderRadius: '8px',
                    border: activeAngle === a.key ? '2px solid #0d7665' : '1px solid #cbd5e1',
                    background: activeAngle === a.key ? '#f0fdf4' : '#ffffff',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: activeAngle === a.key ? '#0d7665' : '#475569',
                    textAlign: 'center'
                  }}
                >
                  {a.label.split(' ')[0]}
                </button>
              ))}
            </div>

            {/* Quick Action: Try-On */}
            <button
              onClick={() => {
                onClose();
                if (onTryOn) onTryOn(product);
              }}
              style={{
                width: '100%',
                marginTop: '1rem',
                padding: '0.85rem',
                background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontWeight: 800,
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(13, 118, 101, 0.25)'
              }}
            >
              <Eye size={18} />
              Open Virtual Try-On
            </button>
          </div>

          {/* Right Column: SPECS, PRICING & SHOP INFO */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a' }}>
                ₹{product.price}
              </div>
              <div style={{
                fontSize: '0.80rem',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '12px',
                backgroundColor: (product.stock_quantity || 0) > 0 ? '#dcfce7' : '#fee2e2',
                color: (product.stock_quantity || 0) > 0 ? '#15803d' : '#b91c1c'
              }}>
                {(product.stock_quantity || 0) > 0 ? `In Stock (${product.stock_quantity} available)` : 'Out of Stock'}
              </div>
            </div>

            <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.5, margin: '0 0 1rem 0' }}>
              {product.description || `${product.brand} ${product.shape} frame in ${product.material}.`}
            </p>

            {/* Technical Specifications Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.65rem',
              background: '#f8fafc',
              padding: '0.85rem',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              marginBottom: '1rem',
              fontSize: '0.82rem'
            }}>
              <div><strong style={{ color: '#64748b' }}>Shape:</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.shape}</span></div>
              <div><strong style={{ color: '#64748b' }}>Material:</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.material}</span></div>
              <div><strong style={{ color: '#64748b' }}>Colour:</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.color}</span></div>
              <div><strong style={{ color: '#64748b' }}>Frame Type:</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.frame_type}</span></div>
              <div><strong style={{ color: '#64748b' }}>Size Stamp:</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.size}</span></div>
              <div><strong style={{ color: '#64748b' }}>Lens Width:</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.lens_width_mm ? `${product.lens_width_mm} mm` : '50 mm'}</span></div>
              <div><strong style={{ color: '#64748b' }}>Bridge (DBL):</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.bridge_width_mm ? `${product.bridge_width_mm} mm` : '18 mm'}</span></div>
              <div><strong style={{ color: '#64748b' }}>Temple Arm:</strong> <span style={{ color: '#0f172a', fontWeight: 700 }}>{product.temple_length_mm ? `${product.temple_length_mm} mm` : '140 mm'}</span></div>
            </div>

            {/* Optical Shop Details (Multi-tenant verified) */}
            {product.shop && (
              <div style={{
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                padding: '0.85rem',
                marginBottom: '1.25rem',
                background: '#ffffff'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0d7665', fontWeight: 800, fontSize: '0.85rem' }}>
                  <Store size={16} />
                  <span>Available at: {product.shop.shop_name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.78rem', marginTop: '4px' }}>
                  <MapPin size={14} />
                  <span>{product.shop.shop_address}</span>
                </div>
                {product.shop.mobile_number && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.78rem', marginTop: '2px' }}>
                    <Phone size={14} />
                    <span>Contact: {product.shop.mobile_number}</span>
                  </div>
                )}
              </div>
            )}

            {/* ORDER / RESERVE FORM */}
            {!showOrderForm ? (
              <button
                disabled={(product.stock_quantity || 0) <= 0}
                onClick={() => setShowOrderForm(true)}
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  background: (product.stock_quantity || 0) > 0 ? '#1e293b' : '#94a3b8',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  cursor: (product.stock_quantity || 0) > 0 ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <ShoppingBag size={18} />
                {(product.stock_quantity || 0) > 0 ? 'Order / Reserve at Store' : 'Out of Stock'}
              </button>
            ) : (
              <form onSubmit={handlePlaceOrder} style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '10px' }}>
                <div style={{ fontSize: '0.90rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
                  Reserve Frame at Optical Shop
                </div>
                <input
                  type="text"
                  placeholder="Your Full Name *"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '0.5rem', boxSizing: 'border-box' }}
                />
                <input
                  type="tel"
                  placeholder="Your 10-digit Phone Number *"
                  required
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '0.75rem', boxSizing: 'border-box' }}
                />

                {orderMessage && (
                  <div style={{
                    padding: '0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.80rem',
                    marginBottom: '0.75rem',
                    background: orderMessage.type === 'success' ? '#dcfce7' : '#fee2e2',
                    color: orderMessage.type === 'success' ? '#15803d' : '#b91c1c'
                  }}>
                    {orderMessage.text}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="submit"
                    disabled={orderLoading}
                    style={{
                      flex: 1,
                      padding: '0.65rem',
                      background: '#0d7665',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    {orderLoading ? 'Confirming...' : 'Confirm Reservation'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOrderForm(false)}
                    style={{
                      padding: '0.65rem 1rem',
                      background: '#e2e8f0',
                      color: '#475569',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

          </div>

        </div>
      </div>
    </div>
  );
}
