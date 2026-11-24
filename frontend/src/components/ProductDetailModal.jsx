import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, ShoppingBag, Eye, Store, Phone, MapPin, Sparkles, ImageOff, ChevronLeft, ChevronRight, MoveHorizontal } from 'lucide-react';
import axios from 'axios';

const ORDERED_VIEW_KEYS = [
  'left_side',
  'left_perspective',
  'front',
  'right_perspective',
  'right_side',
  'rear'
];

const DRAG_SENSITIVITY = 35; // Pixels dragged per discrete angle transition

export default function ProductDetailModal({ product, isOpen, onClose, onTryOn, onOrderSuccess, onAddToCart }) {
  const [activeAngle, setActiveAngle] = useState('front');
  const [isDragging, setIsDragging] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderMessage, setOrderMessage] = useState(null);

  const viewerContainerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const initialIndexRef = useRef(2);
  const activeAngleRef = useRef(activeAngle);
  activeAngleRef.current = activeAngle;

  // Reset to front view whenever a new product modal opens
  useEffect(() => {
    setActiveAngle('front');
    setIsDragging(false);
    isDraggingRef.current = false;
  }, [product?.id, isOpen]);

  // Prevent accidental touch scroll on mobile while dragging frame viewer
  useEffect(() => {
    const el = viewerContainerRef.current;
    if (!el) return;

    const onTouchMoveNative = (e) => {
      if (isDraggingRef.current && e.cancelable) {
        e.preventDefault();
      }
    };

    el.addEventListener('touchmove', onTouchMoveNative, { passive: false });
    return () => {
      el.removeEventListener('touchmove', onTouchMoveNative);
    };
  }, []);

  const handleDragTo = useCallback((clientX) => {
    if (!isDraggingRef.current) return;
    const deltaX = clientX - dragStartXRef.current;
    const stepChange = Math.trunc(deltaX / DRAG_SENSITIVITY);
    const total = ORDERED_VIEW_KEYS.length;
    // Dragging left (deltaX < 0) decreases index (steps towards left-side angles: Left Perspective, Left Side)
    // Dragging right (deltaX > 0) increases index (steps towards right-side angles: Right Perspective, Right Side)
    const newIndex = ((initialIndexRef.current + stepChange) % total + total) % total;
    const targetKey = ORDERED_VIEW_KEYS[newIndex];
    if (targetKey && targetKey !== activeAngleRef.current) {
      setActiveAngle(targetKey);
    }
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      handleDragTo(e.clientX);
    };

    const handleWindowMouseUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging, handleDragTo]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Only primary button
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    const curIdx = ORDERED_VIEW_KEYS.indexOf(activeAngle);
    initialIndexRef.current = curIdx >= 0 ? curIdx : 2;
    setIsDragging(true);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.touches[0].clientX;
    const curIdx = ORDERED_VIEW_KEYS.indexOf(activeAngle);
    initialIndexRef.current = curIdx >= 0 ? curIdx : 2;
    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    if (!isDraggingRef.current || e.touches.length !== 1) return;
    if (e.cancelable) {
      e.preventDefault(); // Prevents accidental page scrolling
    }
    handleDragTo(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  // Step buttons navigation (< and >)
  const handlePrevAngle = (e) => {
    e.stopPropagation();
    const curIdx = ORDERED_VIEW_KEYS.indexOf(activeAngle);
    const total = ORDERED_VIEW_KEYS.length;
    const newIndex = (curIdx - 1 + total) % total;
    setActiveAngle(ORDERED_VIEW_KEYS[newIndex]);
  };

  const handleNextAngle = (e) => {
    e.stopPropagation();
    const curIdx = ORDERED_VIEW_KEYS.indexOf(activeAngle);
    const total = ORDERED_VIEW_KEYS.length;
    const newIndex = (curIdx + 1) % total;
    setActiveAngle(ORDERED_VIEW_KEYS[newIndex]);
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
        product_id: product?.id,
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

  // Real uploaded angle assets check - NEVER duplicate front image for side or perspective views
  const frontImg = (product?.front_image && product.front_image.trim() !== '') ? product.front_image : (product?.image || null);

  const isDuplicateOfFront = (url) => {
    if (!url || !frontImg) return false;
    return url.trim().toLowerCase() === frontImg.trim().toLowerCase();
  };

  const leftPerspectiveImg = (
    (product?.left_perspective_image && !isDuplicateOfFront(product.left_perspective_image) ? product.left_perspective_image.trim() : null) ||
    (product?.perspective_left && !isDuplicateOfFront(product.perspective_left) ? product.perspective_left.trim() : null) ||
    (product?.angled_image && !isDuplicateOfFront(product.angled_image) && product.angled_image_direction !== 'right' ? product.angled_image.trim() : null) ||
    null
  );

  const rightPerspectiveImg = (
    (product?.right_perspective_image && !isDuplicateOfFront(product.right_perspective_image) ? product.right_perspective_image.trim() : null) ||
    (product?.perspective_right && !isDuplicateOfFront(product.perspective_right) ? product.perspective_right.trim() : null) ||
    (product?.angled_image && !isDuplicateOfFront(product.angled_image) && product.angled_image_direction === 'right' ? product.angled_image.trim() : null) ||
    null
  );

  const leftSideImg = (
    (product?.left_side_image && !isDuplicateOfFront(product.left_side_image) ? product.left_side_image.trim() : null) ||
    (product?.side_left && !isDuplicateOfFront(product.side_left) ? product.side_left.trim() : null) ||
    (product?.side_image && !isDuplicateOfFront(product.side_image) && product.side_image_direction !== 'right' ? product.side_image.trim() : null) ||
    null
  );

  const rightSideImg = (
    (product?.right_side_image && !isDuplicateOfFront(product.right_side_image) ? product.right_side_image.trim() : null) ||
    (product?.side_right && !isDuplicateOfFront(product.side_right) ? product.side_right.trim() : null) ||
    (product?.side_image && !isDuplicateOfFront(product.side_image) && product.side_image_direction === 'right' ? product.side_image.trim() : null) ||
    null
  );

  const rearImg = (
    (product?.rear_image && !isDuplicateOfFront(product.rear_image) ? product.rear_image.trim() : null) ||
    (product?.back_image && !isDuplicateOfFront(product.back_image) ? product.back_image.trim() : null) ||
    (product?.rear && !isDuplicateOfFront(product.rear) ? product.rear.trim() : null) ||
    null
  );

  // Discrete 360-degree angle definitions ordered geographically from Left Side to Right Side
  const angles = [
    {
      key: 'left_side',
      label: 'Left Side View',
      shortLabel: 'Left Side',
      angleLabel: '-90°',
      img: leftSideImg,
      isAvailable: Boolean(leftSideImg),
      unavailableNotice: 'A separate left side-profile studio photograph has not been uploaded for this frame model.'
    },
    {
      key: 'left_perspective',
      label: 'Left Perspective View',
      shortLabel: 'Left 3/4',
      angleLabel: '-45°',
      img: leftPerspectiveImg,
      isAvailable: Boolean(leftPerspectiveImg),
      unavailableNotice: 'A separate left-perspective studio photograph has not been uploaded for this frame model.'
    },
    {
      key: 'front',
      label: 'Front View',
      shortLabel: 'Front View',
      angleLabel: '0°',
      img: frontImg,
      isAvailable: Boolean(frontImg),
      unavailableNotice: 'Front photograph is not available for this frame model.'
    },
    {
      key: 'right_perspective',
      label: 'Right Perspective View',
      shortLabel: 'Right 3/4',
      angleLabel: '+45°',
      img: rightPerspectiveImg,
      isAvailable: Boolean(rightPerspectiveImg),
      unavailableNotice: 'A separate right-perspective studio photograph has not been uploaded for this frame model.'
    },
    {
      key: 'right_side',
      label: 'Right Side View',
      shortLabel: 'Right Side',
      angleLabel: '+90°',
      img: rightSideImg,
      isAvailable: Boolean(rightSideImg),
      unavailableNotice: 'A separate right side-profile studio photograph has not been uploaded for this frame model.'
    },
    {
      key: 'rear',
      label: 'Rear View',
      shortLabel: 'Rear View',
      angleLabel: '180°',
      img: rearImg,
      isAvailable: Boolean(rearImg),
      unavailableNotice: 'A rear temple-hinge studio photograph has not been uploaded for this frame model.'
    }
  ];

  if (!isOpen || !product) return null;

  const currentAngleObj = angles.find((a) => a.key === activeAngle) || angles[2];

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
          
          {/* Left Column: 360° MANUAL ROTATION & MULTI-ANGLE STUDIO VIEWER */}
          <div>
            <div
              ref={viewerContainerRef}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              style={{
                background: '#f8fafc',
                border: isDragging ? '2px solid #0d7665' : '2px solid #e2e8f0',
                borderRadius: '12px',
                padding: '1.5rem',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '260px',
                cursor: isDragging ? 'grabbing' : 'grab',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                touchAction: 'none', // Prevents page scroll while dragging on mobile
                transition: 'border-color 0.15s ease'
              }}
            >
              {/* Top Left: Viewer Badge */}
              <div style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#ffffff',
                fontSize: '0.70rem',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                zIndex: 4
              }}>
                <span>360° Studio View</span>
              </div>

              {/* Top Right: Clear Manual Drag Instruction */}
              <div style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                background: isDragging ? '#0d7665' : 'rgba(255, 255, 255, 0.95)',
                color: isDragging ? '#ffffff' : '#334155',
                border: isDragging ? '1px solid #0d7665' : '1px solid #cbd5e1',
                borderRadius: '20px',
                padding: '4px 10px',
                fontSize: '0.72rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                zIndex: 4,
                transition: 'all 0.15s ease'
              }}>
                <MoveHorizontal size={12} />
                <span>{isDragging ? 'Rotating...' : 'Drag to Rotate 360°'}</span>
              </div>

              {/* Left Step Button (<) */}
              <button
                type="button"
                onClick={handlePrevAngle}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                title="Rotate Left (Towards Left Perspective/Side)"
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(255, 255, 255, 0.92)',
                  border: '1px solid #cbd5e1',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#334155',
                  cursor: 'pointer',
                  zIndex: 5,
                  boxShadow: '0 2px 5px rgba(0,0,0,0.08)'
                }}
              >
                <ChevronLeft size={18} />
              </button>

              {/* Right Step Button (>) */}
              <button
                type="button"
                onClick={handleNextAngle}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                title="Rotate Right (Towards Right Perspective/Side)"
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(255, 255, 255, 0.92)',
                  border: '1px solid #cbd5e1',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#334155',
                  cursor: 'pointer',
                  zIndex: 5,
                  boxShadow: '0 2px 5px rgba(0,0,0,0.08)'
                }}
              >
                <ChevronRight size={18} />
              </button>

              {/* Center Frame Display: Uses actual product image or clear unavailable state */}
              {currentAngleObj?.isAvailable ? (
                <img
                  src={currentAngleObj.img}
                  alt={`${product.name} - ${currentAngleObj.label}`}
                  draggable={false}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '190px',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.08))'
                  }}
                  onError={(e) => {
                    e.target.src = '/frames/frame_001.svg';
                  }}
                />
              ) : (
                /* Honest Graceful Fallback (Requirement 3): Never fake angles or duplicate front image */
                <div style={{
                  height: '190px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: '#64748b',
                  textAlign: 'center',
                  padding: '1rem'
                }}>
                  <ImageOff size={38} color="#94a3b8" />
                  <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#334155' }}>
                    {currentAngleObj.label} Not Available
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', maxWidth: '280px', lineHeight: 1.45 }}>
                    {currentAngleObj.unavailableNotice}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => setActiveAngle('front')}
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      style={{
                        padding: '3px 10px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        background: '#f0fdf4',
                        color: '#0d7665',
                        border: '1px solid #bbf7d0',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      Return to Front View
                    </button>
                  </div>
                </div>
              )}
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
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  disabled={(product.stock_quantity || 0) <= 0}
                  onClick={() => {
                    if (onAddToCart) onAddToCart(product);
                  }}
                  style={{
                    flex: 1,
                    padding: '0.85rem',
                    background: (product.stock_quantity || 0) > 0 ? '#0d7665' : '#94a3b8',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontWeight: 800,
                    fontSize: '0.90rem',
                    cursor: (product.stock_quantity || 0) > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <ShoppingBag size={18} />
                  {(product.stock_quantity || 0) > 0 ? 'Add to Cart' : 'Out of Stock'}
                </button>
                <button
                  type="button"
                  disabled={(product.stock_quantity || 0) <= 0}
                  onClick={() => setShowOrderForm(true)}
                  style={{
                    flex: 1,
                    padding: '0.85rem',
                    background: (product.stock_quantity || 0) > 0 ? '#1e293b' : '#94a3b8',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontWeight: 800,
                    fontSize: '0.90rem',
                    cursor: (product.stock_quantity || 0) > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  Reserve Direct
                </button>
              </div>
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
