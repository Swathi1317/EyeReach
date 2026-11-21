import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Glasses,
  Search,
  Filter,
  Eye,
  RotateCw,
  ShoppingBag,
  Store,
  MapPin,
  Sparkles,
  User,
  CheckCircle,
  HelpCircle,
  SlidersHorizontal,
  ArrowRight,
  Calendar,
  Trash2,
  Check
} from 'lucide-react';
import ProductDetailModal from '../ProductDetailModal';

export default function CustomerPortal({
  customerUser,
  onOpenScan,
  onOpenTryOn,
  onOpenAppointment,
  onSwitchToShop,
  detectedFaceData
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState([]);
  const [selectedShopId, setSelectedShopId] = useState('');
  const [genderCategory, setGenderCategory] = useState('All');
  const [faceShapeCategory, setFaceShapeCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductForDetail, setSelectedProductForDetail] = useState(null);

  // EyeReach Collection State
  const [picks, setPicks] = useState([]);
  const [showPicksView, setShowPicksView] = useState(false);
  const [actionToast, setActionToast] = useState('');
  const [selectedForHomeVisit, setSelectedForHomeVisit] = useState(new Set());

  // Fetch registered shops
  const fetchShops = async () => {
    try {
      const res = await axios.get('/api/customer/shops');
      setShops(res.data || []);
    } catch (err) {
      console.error('Error fetching shops:', err);
    }
  };

  // Fetch catalog products
  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/customer/products', {
        params: {
          gender: genderCategory !== 'All' ? genderCategory : undefined,
          face_shape: faceShapeCategory !== 'All' ? faceShapeCategory : undefined,
          shop_id: selectedShopId ? parseInt(selectedShopId) : undefined,
          search: searchQuery ? searchQuery.trim() : undefined
        }
      });
      setProducts(res.data || []);
    } catch (err) {
      console.error('Error fetching customer products:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShops();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [genderCategory, faceShapeCategory, selectedShopId]);

  // Fetch saved customer picks from database
  const fetchPicks = async () => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = customerUser?.mobile ? { customer_mobile: customerUser.mobile } : {};
      const res = await axios.get('/api/customer/picks', { headers, params });
      const list = res.data?.picks || [];
      setPicks(list);
      setSelectedForHomeVisit(new Set(list.map(p => String(p.product_id))));
    } catch (err) {
      console.error('Error fetching frame picks:', err);
    }
  };

  useEffect(() => {
    fetchPicks();
  }, [customerUser?.mobile]);

  const showToast = (msg) => {
    setActionToast(msg);
    setTimeout(() => {
      setActionToast('');
    }, 2500);
  };

  const handleTogglePick = async (prod) => {
    const prodId = prod.product_id || prod.id;
    const isCurrentlyLiked = picks.some(p => String(p.product_id) === String(prodId));

    // Optimistic UI update
    if (isCurrentlyLiked) {
      setPicks(prev => prev.filter(p => String(p.product_id) !== String(prodId)));
      showToast(`Removed "${prod.name}" from Collection`);
    } else {
      const newPick = {
        product_id: prodId,
        brand: prod.brand || 'EyeReach',
        name: prod.name,
        shape: prod.shape || 'Round',
        color: prod.color || 'Black',
        price: prod.price || 0,
        material: prod.material || 'Acetate',
        front_image: prod.front_image || prod.image || ''
      };
      setPicks(prev => [newPick, ...prev]);
      setSelectedForHomeVisit(prev => new Set([...prev, String(prodId)]));
      showToast(`Added "${prod.name}" to Collection`);
    }

    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        customer_mobile: customerUser?.mobile || null,
        product_id: prodId,
        brand: prod.brand || 'EyeReach',
        name: prod.name,
        shape: prod.shape || 'Round',
        color: prod.color || 'Black',
        price: prod.price || 0,
        material: prod.material || 'Acetate',
        front_image: prod.front_image || prod.image || ''
      };
      const res = await axios.post('/api/customer/picks/toggle', payload, { headers });
      if (res.data?.picks) {
        setPicks(res.data.picks);
      }
    } catch (err) {
      console.error('Error toggling frame pick:', err);
      fetchPicks();
    }
  };

  const handleRemovePick = async (productId) => {
    const pId = String(productId);
    setPicks(prev => prev.filter(p => String(p.product_id) !== pId));
    setSelectedForHomeVisit(prev => {
      const next = new Set(prev);
      next.delete(pId);
      return next;
    });
    showToast('Removed frame from Collection');

    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.post('/api/customer/picks/remove', {
        customer_mobile: customerUser?.mobile || null,
        product_id: parseInt(productId) || productId
      }, { headers });
      if (res.data?.picks) {
        setPicks(res.data.picks);
      }
    } catch (err) {
      console.error('Error removing pick:', err);
      fetchPicks();
    }
  };

  const handleToggleSelectForVisit = (productId) => {
    const pId = String(productId);
    setSelectedForHomeVisit(prev => {
      const next = new Set(prev);
      if (next.has(pId)) {
        next.delete(pId);
      } else {
        next.add(pId);
      }
      return next;
    });
  };

  const handleBookVisitWithSelectedPicks = () => {
    const selected = picks.filter(p => selectedForHomeVisit.has(String(p.product_id)));
    const framesToPass = selected.length > 0 ? selected : picks;
    if (onOpenAppointment) {
      onOpenAppointment(framesToPass);
    }
  };

  const faceShapes = [
    { id: 'All', label: 'All Face Shapes' },
    { id: 'Oval', label: 'Oval Face' },
    { id: 'Round', label: 'Round Face' },
    { id: 'Square', label: 'Square Face' },
    { id: 'Heart', label: 'Heart Face' },
    { id: 'Oblong', label: 'Oblong Face' }
  ];

  const genderTabs = ['All', 'Men', 'Women', 'Unisex'];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* HERO SECTION WITH FACIAL ANALYSIS CTA */}
      <section style={{
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        color: '#ffffff',
        padding: '3rem 2rem 2.5rem 2rem',
        borderBottom: '1px solid #334155'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2rem' }}>
          <div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0.35rem 0.85rem',
              borderRadius: '20px',
              backgroundColor: 'rgba(13, 118, 101, 0.3)',
              color: '#34d399',
              fontSize: '0.78rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.85rem'
            }}>
              <Sparkles size={14} />
              AI Optical Boutique & Virtual Fitting
            </div>
            <h1 style={{ fontSize: '2.4rem', fontWeight: 900, margin: '0 0 0.5rem 0', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Find Your Ideal Spectacle Fit.
            </h1>
            <p style={{ fontSize: '1.05rem', color: '#94a3b8', margin: 0, maxWidth: '580px', lineHeight: 1.5 }}>
              Browse curated eyewear collections from trusted local optical stores. Use camera-based biometric scanning to test virtual try-on with millimeter accuracy.
            </p>
          </div>

          {/* Facial Scan Prompt Card */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '16px',
            padding: '1.5rem',
            maxWidth: '380px',
            width: '100%'
          }}>
            {detectedFaceData ? (
              <div>
                <div style={{ fontSize: '0.78rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
                  ✓ Biometric Scan Active
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, margin: '4px 0', textTransform: 'capitalize' }}>
                  {detectedFaceData.face_shape} Face Detected
                </div>
                <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginBottom: '1rem' }}>
                  IPD: <strong>{detectedFaceData.ipd_mm} mm</strong> • Undertone: <strong>{detectedFaceData.undertone || 'Neutral'}</strong>
                </div>
                <button
                  onClick={onOpenScan}
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  ↺ Retake 3-View Biometric Scan
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff', marginBottom: '0.35rem' }}>
                  Don't Know Your Face Shape?
                </div>
                <p style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.4, margin: '0 0 1rem 0' }}>
                  Take a quick 15-second guided scan to measure your Pupillary Distance (IPD) and unlock personalized frame recommendations.
                </p>
                <button
                  onClick={onOpenScan}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.90rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(13, 118, 101, 0.3)'
                  }}
                >
                  <Eye size={18} />
                  <span>Start Biometric Face Scan</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* FILTER & NAVIGATION BAR */}
      <div style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1rem 2rem' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.85rem' }}>
            
            {/* Gender Category Tabs (Module 7: Men, Women, All Frames) */}
            <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
              {genderTabs.map((g) => (
                <button
                  key={g}
                  onClick={() => setGenderCategory(g)}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: genderCategory === g ? '#0f172a' : 'transparent',
                    color: genderCategory === g ? '#ffffff' : '#475569',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {g === 'All' ? 'All Frames' : g}
                </button>
              ))}
            </div>

            {/* Optical Shop Filter & Search Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Store size={18} color="#0d7665" />
                <select
                  value={selectedShopId}
                  onChange={(e) => setSelectedShopId(e.target.value)}
                  style={{
                    padding: '0.55rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    color: '#0f172a',
                    fontWeight: 600,
                    background: '#ffffff'
                  }}
                >
                  <option value="">All Registered Optical Stores</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shop_name} ({s.product_count} frames)
                    </option>
                  ))}
                </select>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '0.45rem 0.75rem',
                background: '#ffffff'
              }}>
                <Search size={16} color="#64748b" />
                <input
                  type="text"
                  placeholder="Search brand, shape, color..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') fetchProducts(); }}
                  style={{ border: 'none', outline: 'none', fontSize: '0.85rem', width: '180px' }}
                />
              </div>
            </div>

          </div>

          {/* Face Shape Filter Pills (Module 7: Oval, Round, Square, Heart, Oblong) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginRight: '4px', whiteSpace: 'nowrap' }}>
              Face Shapes:
            </span>
            {faceShapes.map((fs) => {
              const isSelected = faceShapeCategory === fs.id;
              return (
                <button
                  key={fs.id}
                  onClick={() => setFaceShapeCategory(fs.id)}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: '20px',
                    border: isSelected ? '1px solid #0d7665' : '1px solid #e2e8f0',
                    background: isSelected ? '#f0fdf4' : '#ffffff',
                    color: isSelected ? '#0d7665' : '#475569',
                    fontSize: '0.78rem',
                    fontWeight: isSelected ? 800 : 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {fs.label}
                </button>
              );
            })}
          </div>

        </div>
      </div>

      {/* PRODUCT GRID CONTAINER */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem 2rem 3rem' }}>
        
        {/* EyeReach Appointment Booking Banner */}
        {onOpenAppointment && (
          <div style={{
            background: 'linear-gradient(135deg, #ffffff 0%, #f0fdfa 100%)',
            border: '1px solid #99f6e4',
            borderRadius: '16px',
            padding: '1.15rem 1.5rem',
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '14px',
            boxShadow: '0 4px 15px rgba(13, 148, 136, 0.06)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 4px 10px rgba(2, 132, 199, 0.25)'
              }}>
                <Calendar size={22} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: '#0369a1' }}>
                    EyeReach – Home Testing App
                  </span>
                  <span style={{
                    backgroundColor: '#e0f2fe',
                    color: '#0369a1',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    border: '1px solid #bae6fd'
                  }}>
                    Doctor at Doorstep
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '2px' }}>
                  Need an eye exam or personal frame fitting at your home? Or schedule a 1-on-1 optical consultation meeting.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenAppointment}
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '0.65rem 1.4rem',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)',
                transition: 'all 0.2s'
              }}
            >
              <Calendar size={16} />
              Schedule an Appointment →
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              {showPicksView ? (
                <>
                  <Glasses size={24} color="#0d9488" />
                  <span>My Collection</span>
                </>
              ) : (
                'Spectacle Frame Collection'
              )}
            </h2>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
              {showPicksView 
                ? `Saved to your EyeReach Collection • ${picks.length} frame${picks.length === 1 ? '' : 's'} ready for doorstep trial` 
                : `Showing ${products.length} eyewear styles from registered optical boutiques`}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setShowPicksView(!showPicksView)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: showPicksView ? '#0d9488' : '#ffffff',
                color: showPicksView ? '#ffffff' : '#0f766e',
                border: '1.5px solid #0d9488',
                padding: '0.6rem 1.15rem',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '0.86rem',
                cursor: 'pointer',
                boxShadow: showPicksView ? '0 4px 12px rgba(13, 148, 136, 0.3)' : '0 2px 6px rgba(13, 148, 136, 0.12)',
                transition: 'all 0.15s ease'
              }}
            >
              <Glasses size={16} color={showPicksView ? '#ffffff' : '#0d9488'} />
              <span>{showPicksView ? '← Back to Catalogue' : 'My Collection'}</span>
              <span style={{
                backgroundColor: showPicksView ? '#ffffff' : '#ccfbf1',
                color: '#0f766e',
                borderRadius: '999px',
                padding: '1px 8px',
                fontSize: '0.74rem',
                fontWeight: 800
              }}>
                {picks.length}
              </span>
            </button>
          </div>
        </div>

        {/* VIEW A: DEDICATED "MY COLLECTION" (EYEREACH COLLECTION) SECTION */}
        {showPicksView ? (
          <div>
            {picks.length === 0 ? (
              <div style={{
                padding: '4rem 2rem',
                textAlign: 'center',
                background: '#ffffff',
                borderRadius: '16px',
                border: '1px dashed #cbd5e1'
              }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: '#f0fdfa',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                  border: '1.5px solid #99f6e4'
                }}>
                  <Glasses size={32} color="#0d9488" />
                </div>
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.2rem', fontWeight: 800 }}>
                  Your Collection is Empty
                </h3>
                <p style={{ color: '#64748b', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto 1.5rem', lineHeight: 1.5 }}>
                  You haven't saved any spectacle frames to your collection yet. Tap the spectacles icon on any frame card in the boutique to save your favourites and try them at home!
                </p>
                <button
                  type="button"
                  onClick={() => setShowPicksView(false)}
                  style={{
                    backgroundColor: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.7rem 1.6rem',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(13, 118, 101, 0.25)'
                  }}
                >
                  Browse Spectacle Catalogue
                </button>
              </div>
            ) : (
              <div>
                {/* My Frame Picks Top Action & Home Visit CTA Banner */}
                <div style={{
                  background: 'linear-gradient(135deg, #f0fdfa 0%, #e0f2fe 100%)',
                  border: '1.5px solid #99f6e4',
                  borderRadius: '16px',
                  padding: '1.25rem 1.5rem',
                  marginBottom: '1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '14px',
                  boxShadow: '0 4px 16px rgba(13, 148, 136, 0.08)'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 800, color: '#0f766e' }}>
                        Selected for Doorstep Frame Trial
                      </span>
                      <span style={{
                        backgroundColor: '#ccfbf1',
                        color: '#0f766e',
                        padding: '2px 10px',
                        borderRadius: '999px',
                        fontSize: '0.74rem',
                        fontWeight: 800
                      }}>
                        {selectedForHomeVisit.size} of {picks.length} frames chosen
                      </span>
                    </div>
                    <div style={{ fontSize: '0.84rem', color: '#475569', marginTop: '3px' }}>
                      Check the frames you want our visiting optometrist to bring to your home.
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedForHomeVisit(new Set(picks.map(p => String(p.product_id))))}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#334155',
                        padding: '0.5rem 0.9rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedForHomeVisit(new Set())}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#64748b',
                        padding: '0.5rem 0.9rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>

                    <button
                      type="button"
                      onClick={handleBookVisitWithSelectedPicks}
                      style={{
                        background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '0.65rem 1.4rem',
                        borderRadius: '10px',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 14px rgba(13, 148, 136, 0.3)'
                      }}
                    >
                      <Calendar size={16} />
                      <span>Book Home Visit with Selected Frames ({selectedForHomeVisit.size || picks.length}) →</span>
                    </button>
                  </div>
                </div>

                {/* Saved Picks Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '1.5rem'
                }}>
                  {picks.map((pick) => {
                    const isSelectedForVisit = selectedForHomeVisit.has(String(pick.product_id));
                    return (
                      <div
                        key={pick.product_id}
                        style={{
                          background: '#ffffff',
                          borderRadius: '16px',
                          border: isSelectedForVisit ? '2px solid #0d9488' : '1px solid #e2e8f0',
                          overflow: 'hidden',
                          boxShadow: isSelectedForVisit 
                            ? '0 6px 18px rgba(13, 148, 136, 0.12)' 
                            : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                          display: 'flex',
                          flexDirection: 'column',
                          position: 'relative'
                        }}
                      >
                        {/* Image Area */}
                        <div style={{
                          background: '#f8fafc',
                          padding: '1.5rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minHeight: '170px',
                          position: 'relative'
                        }}>
                          {/* Home Visit Checkbox */}
                          <label
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              top: '12px',
                              left: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              backgroundColor: isSelectedForVisit ? '#0d9488' : '#ffffff',
                              color: isSelectedForVisit ? '#ffffff' : '#334155',
                              padding: '3px 8px',
                              borderRadius: '8px',
                              border: isSelectedForVisit ? '1px solid #0d9488' : '1px solid #cbd5e1',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelectedForVisit}
                              onChange={() => handleToggleSelectForVisit(pick.product_id)}
                              style={{ accentColor: '#ffffff', cursor: 'pointer' }}
                            />
                            <span>{isSelectedForVisit ? 'Home Trial' : 'Select'}</span>
                          </label>

                          {/* Remove from Collection Button */}
                          <button
                            type="button"
                            onClick={() => handleRemovePick(pick.product_id)}
                            title="Remove from Collection"
                            style={{
                              position: 'absolute',
                              top: '12px',
                              right: '12px',
                              width: '34px',
                              height: '34px',
                              borderRadius: '50%',
                              backgroundColor: '#ffffff',
                              border: '1px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <Trash2 size={15} color="#64748b" />
                          </button>

                          <img
                            src={pick.front_image}
                            alt={pick.name}
                            style={{ maxWidth: '100%', maxHeight: '130px', objectFit: 'contain' }}
                            onError={(e) => { e.target.src = '/frames/frame_001.svg'; }}
                          />
                        </div>

                        {/* Details Body */}
                        <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                          <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                            {pick.brand}
                          </div>
                          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', margin: '2px 0 0.5rem 0' }}>
                            {pick.name}
                          </h3>

                          <div style={{ display: 'flex', gap: '6px', fontSize: '0.75rem', color: '#475569', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
                            <span>Shape: <strong>{pick.shape}</strong></span>
                            <span>•</span>
                            <span>Color: <strong>{pick.color}</strong></span>
                            {pick.material && (
                              <>
                                <span>•</span>
                                <span>{pick.material}</span>
                              </>
                            )}
                          </div>

                          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#0f172a' }}>
                              ₹{pick.price}
                            </div>
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '999px',
                              backgroundColor: '#f0fdfa',
                              color: '#0f766e',
                              border: '1px solid #ccfbf1'
                            }}>
                              In Collection
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => onOpenTryOn(pick)}
                              style={{
                                padding: '0.65rem',
                                background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 800,
                                fontSize: '0.82rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px'
                              }}
                            >
                              <Eye size={15} />
                              <span>Try On</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRemovePick(pick.product_id)}
                              style={{
                                padding: '0.65rem',
                                background: '#ffffff',
                                color: '#64748b',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                fontWeight: 700,
                                fontSize: '0.82rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px'
                              }}
                            >
                              <Trash2 size={14} />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* VIEW B: REGULAR CATALOGUE GRID WITH EYEREACH COLLECTION BUTTONS */
          <div>
            {loading ? (
              <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
                Loading eyewear catalogue...
              </div>
            ) : products.length === 0 ? (
              <div style={{ padding: '4rem', textAlign: 'center', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <Glasses size={48} color="#94a3b8" style={{ marginBottom: '1rem' }} />
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a' }}>No frames matching your filters</h3>
                <p style={{ color: '#64748b', fontSize: '0.88rem', margin: 0 }}>
                  Try selecting "All Frames" or choosing a different face shape category.
                </p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '1.5rem'
              }}>
                {products.map((p) => {
                  const isLiked = picks.some(pick => String(pick.product_id) === String(p.id));
                  return (
                    <div
                      key={p.id}
                      style={{
                        background: '#ffffff',
                        borderRadius: '16px',
                        border: isLiked ? '1.5px solid #0d9488' : '1px solid #e2e8f0',
                        overflow: 'hidden',
                        boxShadow: isLiked ? '0 4px 12px rgba(13, 148, 136, 0.1)' : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                      }}
                    >
                      {/* Product Image Area */}
                      <div style={{
                        background: '#f8fafc',
                        padding: '1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '170px',
                        position: 'relative'
                      }}>
                        <span style={{
                          position: 'absolute',
                          top: '12px',
                          left: '12px',
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: '#e0f2fe',
                          color: '#0369a1',
                          textTransform: 'uppercase'
                        }}>
                          {p.shape}
                        </span>

                        {/* Spectacles Button (EyeReach Collection) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePick(p);
                          }}
                          title={isLiked ? "Added to Collection" : "Add to Collection"}
                          style={{
                            position: 'absolute',
                            top: '12px',
                            right: '12px',
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            backgroundColor: isLiked ? '#f0fdfa' : '#ffffff',
                            border: isLiked ? '1.5px solid #0d9488' : '1px solid #cbd5e1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            boxShadow: isLiked ? '0 2px 8px rgba(13, 148, 136, 0.25)' : '0 2px 6px rgba(0,0,0,0.06)',
                            transition: 'all 0.15s ease',
                            zIndex: 2
                          }}
                        >
                          <Glasses 
                            size={18} 
                            color={isLiked ? '#0d9488' : '#94a3b8'} 
                          />
                        </button>

                        <img
                          src={p.front_image}
                          alt={p.name}
                          style={{ maxWidth: '100%', maxHeight: '130px', objectFit: 'contain' }}
                          onError={(e) => { e.target.src = '/frames/frame_001.svg'; }}
                        />
                      </div>

                      {/* Details Body */}
                      <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                        
                        {/* Brand & Frame Name */}
                        <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                          {p.brand}
                        </div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', margin: '2px 0 0.5rem 0' }}>
                          {p.name}
                        </h3>

                        {/* Material & Color Specs */}
                        <div style={{ display: 'flex', gap: '6px', fontSize: '0.75rem', color: '#475569', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
                          <span>Material: <strong>{p.material}</strong></span>
                          <span>•</span>
                          <span>Color: <strong>{p.color}</strong></span>
                          <span>•</span>
                          <span>Size: <strong>{p.size || '50-18-140'}</strong></span>
                        </div>

                        {/* Optical Shop Badge (Multi-Tenant Store Link) */}
                        {p.shop && (
                          <div style={{
                            background: '#f1f5f9',
                            borderRadius: '8px',
                            padding: '0.45rem 0.65rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginBottom: '1rem',
                            fontSize: '0.75rem',
                            color: '#0d7665',
                            fontWeight: 700
                          }}>
                            <Store size={14} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.shop.shop_name}
                            </span>
                          </div>
                        )}

                        {/* Price & Stock Row */}
                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem' }}>
                          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#0f172a' }}>
                            ₹{p.price}
                          </div>
                          <span style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: (p.stock_quantity || 0) > 0 ? '#dcfce7' : '#fee2e2',
                            color: (p.stock_quantity || 0) > 0 ? '#15803d' : '#b91c1c'
                          }}>
                            {(p.stock_quantity || 0) > 0 ? 'In Stock' : 'Out of Stock'}
                          </span>
                        </div>

                        {/* Action Buttons: 1. Try On | 2. 360° Studio View */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => onOpenTryOn(p)}
                            style={{
                              padding: '0.65rem',
                              background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '8px',
                              fontWeight: 800,
                              fontSize: '0.82rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              boxShadow: '0 2px 6px rgba(13, 118, 101, 0.25)'
                            }}
                          >
                            <Eye size={15} />
                            <span>Try On</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedProductForDetail(p)}
                            style={{
                              padding: '0.65rem',
                              background: '#ffffff',
                              color: '#0f172a',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontWeight: 700,
                              fontSize: '0.82rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <RotateCw size={14} />
                            <span>360° View</span>
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Floating Action Feedback Toast */}
      {actionToast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: '#0f172a',
          color: '#ffffff',
          padding: '0.75rem 1.25rem',
          borderRadius: '12px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '0.88rem',
          fontWeight: 600
        }}>
          <Glasses size={16} color="#2dd4bf" />
          <span>{actionToast}</span>
        </div>
      )}

      {/* 360-DEGREE / MULTI-ANGLE MODAL */}
      <ProductDetailModal
        product={selectedProductForDetail}
        isOpen={Boolean(selectedProductForDetail)}
        onClose={() => setSelectedProductForDetail(null)}
        onTryOn={(prod) => {
          setSelectedProductForDetail(null);
          onOpenTryOn(prod);
        }}
        onOrderSuccess={() => {
          setSelectedProductForDetail(null);
          fetchProducts();
        }}
      />

    </div>
  );
}
