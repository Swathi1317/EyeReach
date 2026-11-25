import React, { useState, useEffect, useMemo } from 'react';
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
  Check,
  Clock,
  AlertCircle,
  Stethoscope,
  ShoppingCart,
  Bell,
  FileText,
  Phone,
  Mail,
  Home,
  Plus,
  Minus,
  X,
  CheckCircle2,
  ShieldCheck,
  Download,
  Package,
  Truck
} from 'lucide-react';
import ProductDetailModal from '../ProductDetailModal';

export default function CustomerPortal({
  customerUser,
  onOpenScan,
  onOpenTryOn,
  onOpenAppointment,
  detectedFaceData
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState([]);
  const [selectedShopId, setSelectedShopId] = useState('');
  const [genderCategory, setGenderCategory] = useState('All');
  const [faceShapeCategory, setFaceShapeCategory] = useState('All');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedMaterial, setSelectedMaterial] = useState('All');
  const [selectedPriceRange, setSelectedPriceRange] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductForDetail, setSelectedProductForDetail] = useState(null);

  // EyeReach Collection State (Wishlist)
  const [picks, setPicks] = useState([]);
  const [showPicksView, setShowPicksView] = useState(false);
  const [actionToast, setActionToast] = useState('');
  const [selectedForHomeVisit, setSelectedForHomeVisit] = useState(new Set());

  // Doctor Appointment State for Customer Dashboard
  const [customerAppointment, setCustomerAppointment] = useState(null);
  const [customerAppointments, setCustomerAppointments] = useState([]);
  const [refreshingAppointment, setRefreshingAppointment] = useState(false);

  // ----------------- NEW ENHANCEMENTS STATE -----------------

  // Profile Modal State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: customerUser?.name || '',
    mobile: customerUser?.mobile || '',
    email: customerUser?.email || '',
    address: customerUser?.address || ''
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

  // Cart State
  const [cartItems, setCartItems] = useState([]);
  const [cartTotal, setCartTotal] = useState(0);
  const [trialCount, setTrialCount] = useState(0);
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [checkoutForm, setCheckoutForm] = useState({
    name: customerUser?.name || '',
    mobile: customerUser?.mobile || '',
    email: customerUser?.email || '',
    address: customerUser?.address || '',
    has_prescription: false,
    prescription_text: '',
    prescription_url: '',
    is_home_trial: false,
    notes: ''
  });
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);

  // Customer Orders & Delivery Status (Correction 1 & 8)
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [confirmingOrderId, setConfirmingOrderId] = useState(null);

  // Notifications State
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);

  // Two Distinct Home Services Modal State
  const [showHomeServicesModal, setShowHomeServicesModal] = useState(false);
  const [serviceCategory, setServiceCategory] = useState('both'); // 'frame_trial' | 'vision_test' | 'both'
  const [visionTestOption, setVisionTestOption] = useState('new_test'); // 'existing_rx' | 'new_test'
  const [homeServiceForm, setHomeServiceForm] = useState({
    appointment_date: '',
    appointment_time: '10:30 AM',
    home_address: customerUser?.address || '',
    full_name: customerUser?.name || '',
    mobile_number: customerUser?.mobile || '',
    email: customerUser?.email || '',
    additional_message: '',
    // Existing prescription fields (if visionTestOption === 'existing_rx')
    sph_od: '',
    cyl_od: '',
    axis_od: '',
    add_od: '',
    sph_os: '',
    cyl_os: '',
    axis_os: '',
    add_os: '',
    rx_notes: '',
    rx_file_url: ''
  });
  const [homeServiceSubmitting, setHomeServiceSubmitting] = useState(false);
  const [homeServiceMsg, setHomeServiceMsg] = useState(null);

  // Dynamic Available Slots & Rescheduling/Cancellation State (Mentor Requirement 5)
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [rescheduleModalAppt, setRescheduleModalAppt] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('10:30 AM');
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [cancelModalAppt, setCancelModalAppt] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [personalizedSuggestions, setPersonalizedSuggestions] = useState([]);

  const fetchAvailableSlots = async (targetDate) => {
    if (!targetDate) return;
    setLoadingSlots(true);
    try {
      const res = await axios.get(`/api/customer/available-slots?date=${targetDate}&shop_id=${selectedShopId || ''}`);
      if (res.data?.slots) {
        setAvailableSlots(res.data.slots);
        const avail = res.data.slots.find(s => s.is_available);
        if (avail && !res.data.slots.some(s => s.slot_time === homeServiceForm.appointment_time && s.is_available)) {
          setHomeServiceForm(prev => ({ ...prev, appointment_time: avail.slot_time }));
        }
      }
    } catch (err) {
      console.warn('Failed to load dynamic slots:', err);
    } finally {
      setLoadingSlots(false);
    }
  };

  const fetchRescheduleSlots = async (targetDate, shopId) => {
    if (!targetDate) return;
    try {
      const res = await axios.get(`/api/customer/available-slots?date=${targetDate}&shop_id=${shopId || ''}`);
      if (res.data?.slots) {
        setRescheduleSlots(res.data.slots);
        const avail = res.data.slots.find(s => s.is_available);
        if (avail && !res.data.slots.some(s => s.slot_time === rescheduleTime && s.is_available)) {
          setRescheduleTime(avail.slot_time);
        }
      }
    } catch (err) {
      console.warn('Failed to load reschedule slots:', err);
    }
  };

  const handleCancelAppointment = async (apptId) => {
    if (!apptId) return;
    setCancelling(true);
    try {
      await axios.put(`/api/customer/appointments/${apptId}/cancel`, { reason: 'Cancelled by customer from portal' });
      alert('Your appointment has been cancelled successfully.');
      setCancelModalAppt(null);
      fetchCustomerAppointment();
      fetchNotifications();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to cancel appointment.');
    } finally {
      setCancelling(false);
    }
  };

  const handleRescheduleSubmit = async (e) => {
    e.preventDefault();
    if (!rescheduleModalAppt || !rescheduleDate || !rescheduleTime) return;
    setRescheduleLoading(true);
    try {
      await axios.put(`/api/customer/appointments/${rescheduleModalAppt.id}/reschedule`, {
        new_date: rescheduleDate,
        new_time: rescheduleTime,
        reason: 'Rescheduled by customer from portal'
      });
      alert(`Appointment successfully rescheduled to ${rescheduleDate} at ${rescheduleTime}!`);
      setRescheduleModalAppt(null);
      fetchCustomerAppointment();
      fetchNotifications();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to reschedule appointment. The slot may be fully booked.');
    } finally {
      setRescheduleLoading(false);
    }
  };

  const fetchPersonalizedSuggestions = async () => {
    try {
      const params = {};
      if (customerUser?.mobile) params.customer_mobile = customerUser.mobile;
      const res = await axios.get('/api/customer/personalized-suggestions', { params });
      if (res.data?.suggestions) {
        setPersonalizedSuggestions(res.data.suggestions);
      }
    } catch (err) {
      console.warn('Failed to load personalized suggestions:', err);
    }
  };

  useEffect(() => {
    fetchPersonalizedSuggestions();
  }, [customerUser?.mobile]);

  useEffect(() => {
    if (showHomeServicesModal) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      const targetDate = homeServiceForm.appointment_date || tomorrowStr;
      if (!homeServiceForm.appointment_date) {
        setHomeServiceForm(prev => ({ ...prev, appointment_date: tomorrowStr }));
      }
      fetchAvailableSlots(targetDate);
    }
  }, [showHomeServicesModal]);

  // Prescription View Modal
  const [selectedPrescriptionView, setSelectedPrescriptionView] = useState(null);

  // Sync profile form when customerUser updates
  useEffect(() => {
    if (customerUser) {
      setProfileForm({
        name: customerUser.name || '',
        mobile: customerUser.mobile || '',
        email: customerUser.email || '',
        address: customerUser.address || ''
      });
      setCheckoutForm(prev => ({
        ...prev,
        name: customerUser.name || prev.name,
        mobile: customerUser.mobile || prev.mobile,
        email: customerUser.email || prev.email,
        address: customerUser.address || prev.address
      }));
      setHomeServiceForm(prev => ({
        ...prev,
        full_name: customerUser.name || prev.full_name,
        mobile_number: customerUser.mobile || prev.mobile_number,
        email: customerUser.email || prev.email,
        home_address: customerUser.address || prev.home_address
      }));
    }
  }, [customerUser]);

  // Fetch Cart from Backend
  const fetchCart = async () => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = customerUser?.mobile ? { customer_mobile: customerUser.mobile } : {};
      const res = await axios.get('/api/customer/cart', { headers, params });
      if (res.data?.status === 'success') {
        setCartItems(res.data.items || []);
        setCartTotal(res.data.total_amount || 0);
        setTrialCount(res.data.trial_frames_count || 0);
      }
    } catch (err) {
      console.error('Error fetching cart:', err);
    }
  };

  // Fetch Notifications from Backend
  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = customerUser?.mobile ? { customer_mobile: customerUser.mobile } : {};
      const res = await axios.get('/api/customer/notifications', { headers, params });
      if (res.data?.status === 'success') {
        setNotifications(res.data.notifications || []);
        setUnreadNotifsCount(res.data.unread_count || 0);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  // Fetch Customer Orders from Backend
  const fetchCustomerOrders = async () => {
    try {
      setOrdersLoading(true);
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = customerUser?.mobile ? { customer_mobile: customerUser.mobile } : {};
      const res = await axios.get('/api/customer/orders', { headers, params });
      if (res.data?.status === 'success') {
        setOrders(res.data.orders || []);
      }
    } catch (err) {
      console.error('Error fetching customer orders:', err);
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    fetchCart();
    fetchNotifications();
    fetchCustomerOrders();
  }, [customerUser?.mobile]);

  // Fetch latest customer appointments from backend
  const fetchCustomerAppointment = async () => {
    try {
      if (customerUser?.mobile || customerUser?.email) {
        const params = {};
        if (customerUser.mobile) params.mobile_number = customerUser.mobile;
        if (customerUser.email) params.email = customerUser.email;
        const res = await axios.get('/api/appointments', { params });
        if (Array.isArray(res.data) && res.data.length > 0) {
          setCustomerAppointments(res.data);
          setCustomerAppointment(res.data[0]);
          localStorage.setItem('eyereach_last_appointment_id', res.data[0].appointment_id);
          return;
        }
      }
      const storedApptId = localStorage.getItem('eyereach_last_appointment_id');
      if (storedApptId) {
        const res = await axios.get(`/api/appointments/${storedApptId}`);
        if (res.data) {
          setCustomerAppointment(res.data);
          setCustomerAppointments([res.data]);
        }
      }
    } catch (err) {
      // Quiet fallback if no appointment
    }
  };

  useEffect(() => {
    fetchCustomerAppointment();
  }, [customerUser?.mobile, customerUser?.email]);

  // Real-time polling when appointment is Pending doctor review
  useEffect(() => {
    if (!customerAppointment?.appointment_id || customerAppointment?.status !== 'Pending') return;
    const timer = setInterval(async () => {
      try {
        const res = await axios.get(`/api/appointments/${customerAppointment.appointment_id}`);
        if (res.data && res.data.status !== customerAppointment.status) {
          setCustomerAppointment(res.data);
          fetchCustomerAppointment();
          fetchNotifications();
        }
      } catch (err) {
        // silent polling catch
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [customerAppointment?.appointment_id, customerAppointment?.status]);

  const handleManualRefreshAppointment = async () => {
    setRefreshingAppointment(true);
    try {
      await fetchCustomerAppointment();
      fetchNotifications();
    } catch (err) {
      console.error('Error refreshing appointment status:', err);
    } finally {
      setRefreshingAppointment(false);
    }
  };

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

  // Dynamic filter list for Material from current catalogue
  const availableMaterials = useMemo(() => {
    return ['All', ...new Set(products.map(p => p.material).filter(Boolean))];
  }, [products]);

  // Client-side filtering by Search Query (brand, shape, color, name), Material, and Price Range
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match = (p.name && p.name.toLowerCase().includes(q)) ||
                      (p.brand && p.brand.toLowerCase().includes(q)) ||
                      (p.color && p.color.toLowerCase().includes(q)) ||
                      (p.shape && p.shape.toLowerCase().includes(q)) ||
                      (p.material && p.material.toLowerCase().includes(q));
        if (!match) return false;
      }
      if (selectedMaterial !== 'All' && p.material !== selectedMaterial) return false;
      if (selectedPriceRange === 'under_2000' && p.price >= 2000) return false;
      if (selectedPriceRange === '2000_5000' && (p.price < 2000 || p.price > 5000)) return false;
      if (selectedPriceRange === 'above_5000' && p.price <= 5000) return false;
      return true;
    });
  }, [products, searchQuery, selectedMaterial, selectedPriceRange]);

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
    }, 2800);
  };

  // Toggle Favorite in Wishlist
  const handleTogglePick = async (prod) => {
    const prodId = prod.product_id || prod.id;
    const isCurrentlyLiked = picks.some(p => String(p.product_id) === String(prodId));

    if (isCurrentlyLiked) {
      setPicks(prev => prev.filter(p => String(p.product_id) !== String(prodId)));
      showToast(`Removed "${prod.name}" from Wishlist`);
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
      showToast(`Saved "${prod.name}" to Wishlist ❤️`);
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
    showToast('Removed frame from Wishlist');

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

  // Add Item to Cart
  const handleAddToCart = async (prod, selectedForTrial = false) => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        product_id: prod.id,
        quantity: 1,
        selected_for_trial: selectedForTrial,
        customer_mobile: customerUser?.mobile || null
      };
      const res = await axios.post('/api/customer/cart', payload, { headers });
      showToast(`Added "${prod.name}" to Cart 🛒`);
      fetchCart();
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to add frame to cart.';
      alert(detail);
    }
  };

  // Move from Wishlist to Cart
  const handleMoveWishlistToCart = async (productId) => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.post('/api/customer/cart/move-from-wishlist', {
        product_id: productId,
        customer_mobile: customerUser?.mobile || null
      }, { headers });
      showToast(res.data?.message || 'Moved frame to Cart 🛒');
      fetchCart();
      fetchPicks();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to move to cart.');
    }
  };

  // Update Cart Quantity
  const handleUpdateCartQuantity = async (itemId, newQty) => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await axios.put(`/api/customer/cart/${itemId}`, { quantity: newQty }, { headers });
      fetchCart();
    } catch (err) {
      console.error('Error updating quantity:', err);
    }
  };

  // Toggle Cart Item for Home Trial
  const handleToggleCartTrial = async (itemId, currentVal) => {
    if (!currentVal && trialCount >= 10) {
      alert('You can select a maximum of 10 spectacle frames for home trial.');
      return;
    }
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await axios.put(`/api/customer/cart/${itemId}`, { selected_for_trial: !currentVal }, { headers });
      fetchCart();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to update trial selection.');
    }
  };

  // Remove from Cart
  const handleRemoveFromCart = async (itemId) => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await axios.delete(`/api/customer/cart/${itemId}`, { headers });
      showToast('Item removed from Cart');
      fetchCart();
    } catch (err) {
      console.error('Error removing from cart:', err);
    }
  };

  // Multi-Shop Cart Checkout
  const handleCheckoutCart = async (e) => {
    e.preventDefault();
    if (!checkoutForm.address?.trim() || checkoutForm.address.trim().length < 5) {
      alert('Please enter a valid residential delivery address.');
      return;
    }
    setCheckoutSubmitting(true);
    setCheckoutResult(null);
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        customer_name: checkoutForm.name.trim(),
        customer_phone: checkoutForm.mobile.trim(),
        customer_email: checkoutForm.email.trim(),
        customer_address: checkoutForm.address.trim(),
        has_prescription: checkoutForm.has_prescription,
        prescription_text: checkoutForm.prescription_text.trim() || null,
        prescription_url: checkoutForm.prescription_url.trim() || null,
        is_home_trial: checkoutForm.is_home_trial,
        notes: checkoutForm.notes.trim() || null
      };
      const res = await axios.post('/api/customer/cart/checkout', payload, { headers });
      setCheckoutResult(res.data);
      fetchCart();
      fetchNotifications();
      fetchCustomerOrders();
      showToast('Orders successfully placed across optical shop partners!');
    } catch (err) {
      alert(err.response?.data?.detail || 'Checkout failed. Please check inputs.');
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  // Save Customer Profile
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.put('/api/customer/profile', profileForm, { headers });
      if (res.data?.token) {
        localStorage.setItem('smartframe_token', res.data.token);
      }
      setProfileMsg({ type: 'success', text: 'Profile and address updated successfully!' });
      showToast('Profile Updated');
      fetchNotifications();
      setTimeout(() => {
        setShowProfileModal(false);
        setProfileMsg(null);
      }, 1200);
    } catch (err) {
      setProfileMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to update profile.' });
    } finally {
      setProfileSaving(false);
    }
  };

  // Book Home Service (Service A, Service B, or Both)
  const handleBookHomeService = async (e) => {
    e.preventDefault();
    if (homeServiceSubmitting) return;

    if (!homeServiceForm.appointment_date) {
      alert('Please select a preferred appointment date.');
      return;
    }
    if (!homeServiceForm.home_address?.trim()) {
      alert('Please enter your complete residential address for doorstep visit.');
      return;
    }

    // Prevent duplicate bookings on same date and time slot
    const activeAppts = customerAppointments.length > 0 ? customerAppointments : (customerAppointment ? [customerAppointment] : []);
    const isDuplicate = activeAppts.some(a => 
      (a.status === 'Pending' || a.status === 'Confirmed') &&
      a.appointment_date === homeServiceForm.appointment_date &&
      a.appointment_time === homeServiceForm.appointment_time
    );
    if (isDuplicate) {
      setHomeServiceMsg({
        type: 'error',
        text: `You already have an active doorstep booking on ${homeServiceForm.appointment_date} at ${homeServiceForm.appointment_time}. Please select another date or time slot.`
      });
      return;
    }

    // Prepare frames list for trial (Only for Frame Trial or Both Services; empty for Vision Test Only)
    let trialFrames = [];
    if (serviceCategory === 'frame_trial' || serviceCategory === 'both') {
      const cartTrialItems = cartItems.filter(i => i.selected_for_trial);
      if (cartTrialItems.length > 0) {
        trialFrames = cartTrialItems.map(i => ({
          product_id: i.product_id,
          name: i.name,
          brand: i.brand,
          price: i.price,
          front_image: i.front_image
        }));
      } else if (picks.length > 0) {
        trialFrames = picks.slice(0, 10).map(p => ({
          product_id: p.product_id,
          name: p.name,
          brand: p.brand,
          price: p.price,
          front_image: p.front_image
        }));
      }
    }

    if ((serviceCategory === 'frame_trial' || serviceCategory === 'both') && trialFrames.length > 10) {
      alert('You can select a maximum of 10 frames for home trial.');
      return;
    }

    setHomeServiceSubmitting(true);
    setHomeServiceMsg(null);
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const hasRx = (serviceCategory === 'vision_test' || serviceCategory === 'both') && visionTestOption === 'existing_rx';
      const rxData = hasRx ? {
        sph_od: parseFloat(homeServiceForm.sph_od) || 0,
        cyl_od: parseFloat(homeServiceForm.cyl_od) || 0,
        axis_od: parseFloat(homeServiceForm.axis_od) || 0,
        add_od: homeServiceForm.add_od ? parseFloat(homeServiceForm.add_od) : null,
        sph_os: parseFloat(homeServiceForm.sph_os) || 0,
        cyl_os: parseFloat(homeServiceForm.cyl_os) || 0,
        axis_os: parseFloat(homeServiceForm.axis_os) || 0,
        add_os: homeServiceForm.add_os ? parseFloat(homeServiceForm.add_os) : null,
        notes: homeServiceForm.rx_notes || 'Customer entered existing valid prescription.'
      } : null;

      const payload = {
        service_type: serviceCategory,
        appointment_date: homeServiceForm.appointment_date,
        appointment_time: homeServiceForm.appointment_time,
        full_name: homeServiceForm.full_name.trim(),
        mobile_number: homeServiceForm.mobile_number.trim(),
        email: homeServiceForm.email.trim(),
        home_address: homeServiceForm.home_address.trim(),
        additional_message: homeServiceForm.additional_message.trim() || null,
        selected_frames: trialFrames,
        has_prescription: hasRx,
        prescription_data: rxData,
        prescription_file: homeServiceForm.rx_file_url || null,
        face_analysis: detectedFaceData ? {
          face_shape: detectedFaceData.face_shape,
          ipd_mm: detectedFaceData.ipd_mm,
          face_analysis_summary: "Physical frame sizing reference only. Camera measurements do not determine eye power."
        } : null
      };

      const res = await axios.post('/api/customer/home-services/book', payload, { headers });
      setHomeServiceMsg({ type: 'success', text: res.data.message });
      fetchCustomerAppointment();
      fetchNotifications();
      showToast('Home Service Request Submitted');
      setTimeout(() => {
        setShowHomeServicesModal(false);
        setHomeServiceMsg(null);
      }, 2000);
    } catch (err) {
      setHomeServiceMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to submit home service request.' });
    } finally {
      setHomeServiceSubmitting(false);
    }
  };

  // Mark Notification as read
  const handleMarkNotifRead = async (notifId) => {
    try {
      await axios.patch(`/api/customer/notifications/${notifId}/read`);
      setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, is_read: true } : n));
      setUnreadNotifsCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Error marking notification read:', err);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = customerUser?.mobile ? { customer_mobile: customerUser.mobile } : {};
      await axios.post('/api/customer/notifications/mark-all-read', {}, { headers, params });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadNotifsCount(0);
    } catch (err) {
      console.error('Error marking all read:', err);
    }
  };

  const handleScheduleCheckup = async (months = 6) => {
    try {
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = { months, customer_mobile: customerUser?.mobile };
      await axios.post('/api/customer/reminders/checkup', {}, { headers, params });
      showToast(`Reminder scheduled for ${months} months!`);
      fetchNotifications();
    } catch (err) {
      console.error('Error scheduling checkup:', err);
    }
  };

  // Confirm Customer Delivery Receipt (Correction 1)
  const handleConfirmDelivery = async (orderId) => {
    try {
      setConfirmingOrderId(orderId);
      const token = localStorage.getItem('smartframe_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const params = customerUser?.mobile ? { customer_mobile: customerUser.mobile } : {};
      const res = await axios.patch(`/api/customer/orders/${orderId}/received`, {}, { headers, params });
      if (res.data?.status === 'success') {
        showToast('Delivery Confirmed! Marked as Customer Received');
        fetchCustomerOrders();
        fetchNotifications();
      }
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to confirm delivery receipt.');
    } finally {
      setConfirmingOrderId(null);
    }
  };

  const getOrderStatusStep = (statusStr) => {
    if (!statusStr) return 1;
    const s = statusStr.toLowerCase();
    if (s.includes('received') || s === 'completed') return 6;
    if (s.includes('delivered')) return 5;
    if (s.includes('dispatched') || s.includes('shipped')) return 4;
    if (s.includes('preparing')) return 3;
    if (s.includes('accepted') || s.includes('confirmed')) return 2;
    if (s.includes('placed') || s.includes('pending')) return 1;
    return 1;
  };

  const faceShapes = [
    { id: 'All', label: 'All Face Shapes' },
    { id: 'Oval', label: 'Oval Face' },
    { id: 'Round', label: 'Round Face' },
    { id: 'Square', label: 'Square Face' },
    { id: 'Heart', label: 'Heart Face' },
    { id: 'Diamond', label: 'Diamond Face' },
    { id: 'Oblong', label: 'Oblong Face' }
  ];

  const genderTabs = ['All', 'Men', 'Women', 'Unisex'];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* HERO SECTION WITH FACIAL ANALYSIS CTA */}
      <section style={{
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        color: '#ffffff',
        padding: '2.5rem 2rem 2rem 2rem',
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
              Connected Optical Boutique & Home Testing
            </div>
            <h1 style={{ fontSize: '2.3rem', fontWeight: 900, margin: '0 0 0.5rem 0', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Shop Frames & Schedule Doorstep Care.
            </h1>
            <p style={{ fontSize: '0.98rem', color: '#94a3b8', margin: 0, maxWidth: '620px', lineHeight: 1.5 }}>
              Browse optical frames from trusted local optical shops. Book <strong>Frame Selection Home Visits</strong> (up to 10 trial frames) or <strong>Home Vision Examinations</strong> with certified optometrists.
            </p>
          </div>

          {/* Facial Scan Prompt Card */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '16px',
            padding: '1.25rem 1.5rem',
            maxWidth: '360px',
            width: '100%'
          }}>
            {detectedFaceData ? (
              <div>
                <div style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
                  ✓ Fitting Assistant Active
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, margin: '4px 0', textTransform: 'capitalize' }}>
                  {detectedFaceData.face_shape} Face Detected
                </div>
                <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginBottom: '0.85rem' }}>
                  IPD: <strong>{detectedFaceData.ipd_mm} mm</strong> • Facial measurements assist physical frame fit only.
                </div>
                <button
                  onClick={onOpenScan}
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  ↺ Retake Biometric Fit Scan
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#ffffff', marginBottom: '0.25rem' }}>
                  Assisted Frame Fitting
                </div>
                <p style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4, margin: '0 0 0.85rem 0' }}>
                  Guided scan measures your Pupillary Distance (IPD) to help select perfectly proportional spectacle frames.
                </p>
                <button
                  onClick={onOpenScan}
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(13, 118, 101, 0.3)'
                  }}
                >
                  <Eye size={16} />
                  <span>Start Fit Scan</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* FILTER & TOP ACTION BAR */}
      <div style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0.85rem 2rem' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.85rem', marginBottom: '0.75rem' }}>
            
            {/* Gender Category Tabs */}
            <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
              {genderTabs.map((g) => (
                <button
                  key={g}
                  onClick={() => setGenderCategory(g)}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: genderCategory === g ? '#0f172a' : 'transparent',
                    color: genderCategory === g ? '#ffffff' : '#475569',
                    fontWeight: 700,
                    fontSize: '0.82rem',
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
                <Store size={16} color="#0d7665" />
                <select
                  value={selectedShopId}
                  onChange={(e) => setSelectedShopId(e.target.value)}
                  style={{
                    padding: '0.5rem 0.8rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    color: '#0f172a',
                    fontWeight: 600,
                    background: '#ffffff'
                  }}
                >
                  <option value="">All Partner Optical Stores</option>
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
                padding: '0.4rem 0.75rem',
                background: '#ffffff'
              }}>
                <Search size={15} color="#64748b" />
                <input
                  type="text"
                  placeholder="Search brand, shape, color..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') fetchProducts(); }}
                  style={{ border: 'none', outline: 'none', fontSize: '0.82rem', width: '160px' }}
                />
              </div>

              {/* ACTION BUTTONS (Cart, Home Services, Notifications, Profile) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                
                {/* Cart Button */}
                <button
                  type="button"
                  onClick={() => setShowCartDrawer(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.5rem 0.9rem',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(13, 118, 101, 0.25)'
                  }}
                  title="View Shopping Cart & Select Trial Frames"
                >
                  <ShoppingCart size={15} />
                  <span>Cart</span>
                  <span style={{
                    backgroundColor: '#ffffff',
                    color: '#0d7665',
                    borderRadius: '999px',
                    padding: '1px 6px',
                    fontSize: '0.70rem',
                    fontWeight: 800
                  }}>
                    {cartItems.length}
                  </span>
                </button>

                {/* Orders & Delivery Tracking Button (Correction 1 & 8) */}
                <button
                  type="button"
                  onClick={() => {
                    fetchCustomerOrders();
                    setShowOrdersModal(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#ffffff',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    padding: '0.5rem 0.85rem',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                  title="View My Orders & Track Delivery Status"
                >
                  <Package size={15} color="#0d7665" />
                  <span>Orders</span>
                  {orders.length > 0 && (
                    <span style={{
                      backgroundColor: '#0d7665',
                      color: '#ffffff',
                      borderRadius: '999px',
                      padding: '1px 6px',
                      fontSize: '0.70rem',
                      fontWeight: 800
                    }}>
                      {orders.length}
                    </span>
                  )}
                </button>

                {/* Doorstep Home Services Button */}
                <button
                  type="button"
                  onClick={() => setShowHomeServicesModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.5rem 0.9rem',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <Home size={15} />
                  <span>Doorstep Services</span>
                </button>

                {/* Notifications Bell */}
                <button
                  type="button"
                  onClick={() => setShowNotificationsModal(true)}
                  style={{
                    position: 'relative',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '0.5rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title="Notifications & Updates"
                >
                  <Bell size={16} color="#334155" />
                  {unreadNotifsCount > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      borderRadius: '50%',
                      width: '16px',
                      height: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {unreadNotifsCount}
                    </span>
                  )}
                </button>

                {/* Customer Profile Button */}
                <button
                  type="button"
                  onClick={() => setShowProfileModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '0.5rem 0.8rem',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: '#1e293b',
                    cursor: 'pointer'
                  }}
                  title="Manage Profile and Residential Address"
                >
                  <User size={15} color="#0d7665" />
                  <span style={{ maxWidth: '85px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {customerUser?.name?.split(' ')[0] || 'Profile'}
                  </span>
                </button>

              </div>

            </div>

          </div>

          {/* Face Shape Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginRight: '4px', whiteSpace: 'nowrap' }}>
              Face Shapes:
            </span>
            {faceShapes.map((fs) => {
              const isSelected = faceShapeCategory === fs.id;
              return (
                <button
                  key={fs.id}
                  onClick={() => setFaceShapeCategory(fs.id)}
                  style={{
                    padding: '0.3rem 0.7rem',
                    borderRadius: '20px',
                    border: isSelected ? '1px solid #0d7665' : '1px solid #e2e8f0',
                    background: isSelected ? '#f0fdf4' : '#ffffff',
                    color: isSelected ? '#0d7665' : '#475569',
                    fontSize: '0.75rem',
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

          {/* Secondary Filter Bar: Material, Price Range, and Active Filters */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            marginTop: '0.65rem',
            paddingTop: '0.65rem',
            borderTop: '1px dashed #e2e8f0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Material Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                  Material:
                </span>
                <select
                  value={selectedMaterial}
                  onChange={(e) => setSelectedMaterial(e.target.value)}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.78rem',
                    color: '#0f172a',
                    fontWeight: 600,
                    background: '#ffffff',
                    cursor: 'pointer'
                  }}
                >
                  {availableMaterials.map((m) => (
                    <option key={m} value={m}>{m === 'All' ? 'All Materials' : m}</option>
                  ))}
                </select>
              </div>

              {/* Price Range Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                  Price:
                </span>
                <select
                  value={selectedPriceRange}
                  onChange={(e) => setSelectedPriceRange(e.target.value)}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.78rem',
                    color: '#0f172a',
                    fontWeight: 600,
                    background: '#ffffff',
                    cursor: 'pointer'
                  }}
                >
                  <option value="All">All Prices</option>
                  <option value="under_2000">Under ₹2,000</option>
                  <option value="2000_5000">₹2,000 - ₹5,000</option>
                  <option value="above_5000">Above ₹5,000</option>
                </select>
              </div>

              {/* Reset Filters button if any are active */}
              {(selectedMaterial !== 'All' || selectedPriceRange !== 'All' || genderCategory !== 'All' || faceShapeCategory !== 'All' || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMaterial('All');
                    setSelectedPriceRange('All');
                    setGenderCategory('All');
                    setFaceShapeCategory('All');
                    setSearchQuery('');
                  }}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    color: '#dc2626',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Reset Filters
                </button>
              )}
            </div>

            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
              Showing <strong>{filteredProducts.length}</strong> of {products.length} frames
            </span>
          </div>

        </div>
      </div>

      {/* PRODUCT GRID CONTAINER */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem 2rem 3rem' }}>
        
        {/* Live Doctor Appointment Status Card */}
        {(customerAppointments.length > 0 ? customerAppointments.filter(a => a.status !== 'Completed') : (customerAppointment ? [customerAppointment] : [])).slice(0, 2).map((appt) => (
          <div key={appt.appointment_id || appt.id} style={{
            background: appt.status === 'Confirmed'
              ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'
              : appt.status === 'Rejected'
                ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)'
                : 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
            border: appt.status === 'Confirmed'
              ? '1px solid #86efac'
              : appt.status === 'Rejected'
                ? '1px solid #fecaca'
                : '1px solid #bae6fd',
            borderRadius: '16px',
            padding: '1.25rem 1.6rem',
            marginBottom: '1rem',
            boxShadow: '0 4px 15px rgba(0,0,0,0.04)'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flex: 1, minWidth: '280px' }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: appt.status === 'Confirmed'
                    ? '#16a34a'
                    : appt.status === 'Rejected'
                      ? '#dc2626'
                      : (appt.service_type === 'frame_trial' ? '#0d7665' : '#0284c7'),
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                }}>
                  {appt.status === 'Confirmed' ? (
                    <CheckCircle size={24} />
                  ) : appt.status === 'Rejected' ? (
                    <AlertCircle size={24} />
                  ) : (
                    <Clock size={24} />
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      background: appt.service_type === 'frame_trial' ? '#dcfce7' : '#e0f2fe',
                      color: appt.service_type === 'frame_trial' ? '#0d7665' : '#0369a1'
                    }}>
                      {appt.service_type === 'frame_trial' ? 'Frame Trial at Home' : appt.service_type === 'vision_test' ? 'Home Vision Test' : 'Doorstep Service'}
                    </span>
                    <span style={{
                      fontSize: '1.02rem',
                      fontWeight: 800,
                      color: appt.status === 'Confirmed'
                        ? '#15803d'
                        : appt.status === 'Rescheduled'
                          ? '#0284c7'
                          : appt.status === 'Cancelled'
                            ? '#64748b'
                            : appt.status === 'Rejected'
                              ? '#b91c1c'
                              : '#0369a1'
                    }}>
                      {appt.status === 'Confirmed'
                        ? 'Your home appointment has been confirmed!'
                        : appt.status === 'Rescheduled'
                          ? 'Your appointment has been rescheduled'
                          : appt.status === 'Cancelled'
                            ? 'Appointment Cancelled'
                            : appt.status === 'Rejected'
                              ? 'Appointment Request Declined'
                              : 'Your doorstep service request is pending optical shop confirmation'}
                    </span>
                    <span style={{
                      backgroundColor: appt.status === 'Confirmed'
                        ? '#dcfce7'
                        : appt.status === 'Rescheduled'
                          ? '#e0f2fe'
                          : appt.status === 'Cancelled'
                            ? '#f1f5f9'
                            : appt.status === 'Rejected'
                              ? '#fee2e2'
                              : '#fef3c7',
                      color: appt.status === 'Confirmed'
                        ? '#15803d'
                        : appt.status === 'Rescheduled'
                          ? '#0284c7'
                          : appt.status === 'Cancelled'
                            ? '#64748b'
                            : appt.status === 'Rejected'
                              ? '#b91c1c'
                              : '#b45309',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '2px 9px',
                      borderRadius: '999px',
                      border: appt.status === 'Confirmed'
                        ? '1px solid #bbf7d0'
                        : appt.status === 'Rescheduled'
                          ? '1px solid #bae6fd'
                          : appt.status === 'Cancelled'
                            ? '1px solid #cbd5e1'
                            : appt.status === 'Rejected'
                              ? '1px solid #fecaca'
                              : '1px solid #fde68a'
                    }}>
                      {appt.status === 'Confirmed'
                        ? '✓ Confirmed'
                        : appt.status === 'Rescheduled'
                          ? '↻ Rescheduled'
                          : appt.status === 'Cancelled'
                            ? '✗ Cancelled'
                            : appt.status === 'Rejected'
                              ? '✗ Declined'
                              : '⏳ Pending Shop Confirmation'}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.45 }}>
                    {appt.status === 'Confirmed' ? (
                      <>
                        The optical store has scheduled your appointment for <strong>{appt.appointment_date}</strong> at <strong>{appt.appointment_time}</strong>.
                        {appt.doctor_name && (
                          <span> Visiting Optometrist: <strong>{appt.doctor_name}</strong>.</span>
                        )}
                        {appt.home_address && (
                          <div style={{ fontSize: '0.80rem', color: '#64748b', marginTop: '3px' }}>
                            📍 Doorstep Destination: {appt.home_address}
                          </div>
                        )}
                      </>
                    ) : appt.status === 'Rejected' ? (
                      <>
                        Your request could not be confirmed.
                        {appt.rejection_reason && (
                          <span> Reason: <em>"{appt.rejection_reason}"</em></span>
                        )}
                        {appt.doctor_notes && (
                          <span> Note: <em>"{appt.doctor_notes}"</em></span>
                        )}
                      </>
                    ) : (
                      <>
                        Requested for <strong>{appt.appointment_date}</strong> at <strong>{appt.appointment_time}</strong>.
                        Ref: <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: '4px' }}>{appt.appointment_id}</code>.
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleManualRefreshAppointment}
                  disabled={refreshingAppointment}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '0.45rem 0.85rem',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '0.80rem',
                    fontWeight: 700,
                    color: '#334155',
                    cursor: refreshingAppointment ? 'not-allowed' : 'pointer',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                  title="Check latest status from database"
                >
                  <RotateCw size={13} style={{ animation: refreshingAppointment ? 'spin 1s linear infinite' : 'none' }} />
                  <span>{refreshingAppointment ? 'Checking...' : 'Refresh'}</span>
                </button>

                {['Pending', 'Confirmed', 'Rescheduled', 'Approved', 'Scheduled'].includes(appt.status) && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setRescheduleModalAppt(appt);
                        setRescheduleDate(appt.appointment_date || new Date().toISOString().split('T')[0]);
                        setRescheduleTime(appt.appointment_time || '10:30 AM');
                        fetchRescheduleSlots(appt.appointment_date || new Date().toISOString().split('T')[0], appt.shop_id);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '0.45rem 0.85rem',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '8px',
                        fontSize: '0.80rem',
                        fontWeight: 700,
                        color: '#1d4ed8',
                        cursor: 'pointer'
                      }}
                      title="Reschedule appointment date or time"
                    >
                      <Calendar size={13} />
                      <span>Reschedule</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCancelModalAppt(appt)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '0.45rem 0.85rem',
                        background: '#fff1f2',
                        border: '1px solid #fecdd3',
                        borderRadius: '8px',
                        fontSize: '0.80rem',
                        fontWeight: 700,
                        color: '#e11d48',
                        cursor: 'pointer'
                      }}
                      title="Cancel this appointment"
                    >
                      <X size={13} />
                      <span>Cancel</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setShowHomeServicesModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '0.45rem 0.95rem',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0d9488 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.80rem',
                    fontWeight: 700,
                    color: '#ffffff',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(2, 132, 199, 0.2)'
                  }}
                >
                  <Calendar size={13} />
                  <span>{appt.status === 'Rejected' ? 'Book Another Visit' : 'Manage Home Services'}</span>
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* SECTION HEADER: TITLE & WISHLIST SWITCHER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              {showPicksView ? (
                <>
                  <Glasses size={24} color="#0d9488" />
                  <span>My Wishlist ({picks.length})</span>
                </>
              ) : (
                'Spectacle Frame Collection'
              )}
            </h2>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
              {showPicksView 
                ? `Favorite frames saved to your Wishlist • Move items to cart or select up to 10 for doorstep home visit trial` 
                : `Showing ${filteredProducts.length} eyewear styles from registered optical boutiques`}
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
                padding: '0.55rem 1.1rem',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '0.84rem',
                cursor: 'pointer',
                boxShadow: showPicksView ? '0 4px 12px rgba(13, 148, 136, 0.3)' : '0 2px 6px rgba(13, 148, 136, 0.12)',
                transition: 'all 0.15s ease'
              }}
            >
              <Glasses size={16} color={showPicksView ? '#ffffff' : '#0d9488'} />
              <span>{showPicksView ? '← Back to Catalogue' : 'My Wishlist'}</span>
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

        {/* VIEW A: WISHLIST VIEW */}
        {showPicksView ? (
          <div>
            {picks.length === 0 ? (
              <div style={{
                backgroundColor: '#ffffff',
                border: '2px dashed #cbd5e1',
                borderRadius: '16px',
                padding: '4rem 2rem',
                textAlign: 'center'
              }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1.25rem auto'
                }}>
                  <Glasses size={32} color="#94a3b8" />
                </div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
                  Your Wishlist is Empty
                </h3>
                <p style={{ fontSize: '0.90rem', color: '#64748b', maxWidth: '440px', margin: '0 auto 1.5rem auto' }}>
                  Click the heart/glasses icon on any frame in the catalogue to save it to your Wishlist for easy moving to your cart or home trial.
                </p>
                <button
                  type="button"
                  onClick={() => setShowPicksView(false)}
                  style={{
                    backgroundColor: '#0d9488',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.7rem 1.5rem',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer'
                  }}
                >
                  Browse Spectacle Frames
                </button>
              </div>
            ) : (
              <div>
                {/* Wishlist Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '1.5rem'
                }}>
                  {picks.map((pick) => {
                    return (
                      <div
                        key={pick.product_id}
                        style={{
                          background: '#ffffff',
                          borderRadius: '16px',
                          border: '1px solid #e2e8f0',
                          overflow: 'hidden',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
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
                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => handleRemovePick(pick.product_id)}
                            title="Remove from Wishlist"
                            style={{
                              position: 'absolute',
                              top: '12px',
                              right: '12px',
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              backgroundColor: '#ffffff',
                              border: '1px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer'
                            }}
                          >
                            <Trash2 size={14} color="#64748b" />
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
                              In Wishlist
                            </span>
                          </div>

                          {/* Action Buttons: 1. Move to Cart | 2. Try On */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => handleMoveWishlistToCart(pick.product_id)}
                              style={{
                                padding: '0.65rem',
                                background: '#0d7665',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 800,
                                fontSize: '0.80rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '5px'
                              }}
                            >
                              <ShoppingCart size={14} />
                              <span>Move to Cart</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onOpenTryOn(pick)}
                              style={{
                                padding: '0.65rem',
                                background: '#ffffff',
                                color: '#0f172a',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                fontWeight: 700,
                                fontSize: '0.80rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '5px'
                              }}
                            >
                              <Eye size={14} />
                              <span>Try On</span>
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
          /* VIEW B: CATALOGUE GRID */
          <div>
            {/* PERSONALIZED IN-STOCK SUGGESTIONS (Requirement 8) */}
            {personalizedSuggestions.length > 0 && (
              <div style={{
                background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)',
                borderRadius: '16px',
                border: '1px solid #bbf7d0',
                padding: '1.25rem',
                marginBottom: '1.5rem',
                boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={18} color="#0d9488" />
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                      Personalized In-Stock Picks For You
                    </h3>
                    <span style={{ fontSize: '0.70rem', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '999px', fontWeight: 800 }}>
                      ✓ Strictly In Stock
                    </span>
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Curated for your facial geometry & style preferences
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '12px'
                }}>
                  {personalizedSuggestions.slice(0, 4).map(s => (
                    <div
                      key={s.id}
                      onClick={() => setSelectedProductForDetail(s)}
                      style={{
                        background: '#ffffff',
                        borderRadius: '12px',
                        padding: '0.85rem',
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                      }}
                    >
                      <div style={{ height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '6px' }}>
                        <img src={s.front_image} alt={s.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '0.80rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.name}
                      </div>
                      <div style={{ fontSize: '0.70rem', color: '#0d9488', fontWeight: 700, margin: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.match_reason}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a' }}>₹{s.price}</span>
                        <span style={{ fontSize: '0.68rem', color: '#15803d', fontWeight: 700 }}>In Stock ({s.stock_quantity})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
                Loading optical catalogue...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div style={{ padding: '4rem', textAlign: 'center', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <Glasses size={48} color="#94a3b8" style={{ marginBottom: '1rem' }} />
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a' }}>No frames matching your filters</h3>
                <p style={{ color: '#64748b', fontSize: '0.88rem', margin: 0 }}>
                  Try selecting "All Frames", searching for a different brand or shape, or resetting filters.
                </p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '1.5rem'
              }}>
                {filteredProducts.map((p) => {
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

                        {/* Wishlist Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePick(p);
                          }}
                          title={isLiked ? "Saved to Wishlist" : "Save to Wishlist"}
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
                            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
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
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', margin: '2px 0 0.4rem 0' }}>
                          {p.name}
                        </h3>

                        {/* Material, Color & Dimension Specs (Part 1 - Requirement 2) */}
                        <div style={{ display: 'flex', gap: '6px', fontSize: '0.75rem', color: '#475569', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
                          <span>Material: <strong>{p.material}</strong></span>
                          <span>•</span>
                          <span>Color: <strong>{p.color}</strong></span>
                          <span>•</span>
                          <span>Size: <strong>{p.size || '50-18-140'}</strong></span>
                        </div>

                        {/* Boxing Physical Dimensions */}
                        {(p.lens_width_mm || p.bridge_width_mm || p.temple_length_mm) && (
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.65rem' }}>
                            Dims: Lens <strong>{p.lens_width_mm || 50}mm</strong> | Bridge <strong>{p.bridge_width_mm || 18}mm</strong> | Temple <strong>{p.temple_length_mm || 140}mm</strong>
                          </div>
                        )}

                        {/* Optical Shop Supplier Badge (Part 1 - Requirement 2) */}
                        {p.shop && (
                          <div style={{
                            background: '#f1f5f9',
                            borderRadius: '8px',
                            padding: '0.45rem 0.65rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginBottom: '0.85rem',
                            fontSize: '0.75rem',
                            color: '#0d7665',
                            fontWeight: 700
                          }}>
                            <Store size={14} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              Supplied by: {p.shop.shop_name}
                            </span>
                          </div>
                        )}

                        {/* Price & In-Stock Availability */}
                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#0f172a' }}>
                            ₹{p.price}
                          </div>
                          <span style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: (p.stock_quantity || 0) > 0 ? '#dcfce7' : '#fee2e2',
                            color: (p.stock_quantity || 0) > 0 ? '#15803d' : '#b91c1c'
                          }}>
                            {(p.stock_quantity || 0) > 0 ? `In Stock (${p.stock_quantity})` : 'Out of Stock'}
                          </span>
                        </div>

                        {/* Action Buttons: 1. Add to Cart | 2. Try On | 3. Details */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '6px' }}>
                          <button
                            type="button"
                            disabled={(p.stock_quantity || 0) <= 0}
                            onClick={() => handleAddToCart(p)}
                            style={{
                              padding: '0.6rem 0.4rem',
                              background: (p.stock_quantity || 0) > 0 ? '#0d7665' : '#94a3b8',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '8px',
                              fontWeight: 800,
                              fontSize: '0.78rem',
                              cursor: (p.stock_quantity || 0) > 0 ? 'pointer' : 'not-allowed',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px'
                            }}
                          >
                            <ShoppingCart size={13} />
                            <span>Add Cart</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenTryOn(p)}
                            style={{
                              padding: '0.6rem 0.4rem',
                              background: '#1e293b',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '8px',
                              fontWeight: 700,
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px'
                            }}
                          >
                            <Eye size={13} />
                            <span>Try On</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedProductForDetail(p)}
                            style={{
                              padding: '0.6rem 0.4rem',
                              background: '#ffffff',
                              color: '#0f172a',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontWeight: 700,
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px'
                            }}
                          >
                            <RotateCw size={13} />
                            <span>Details</span>
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

      {/* ----------------- SHOPPING CART DRAWER (Part 1 - Requirement 3) ----------------- */}
      {showCartDrawer && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 999,
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '460px',
            backgroundColor: '#ffffff',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.2)'
          }}>
            {/* Drawer Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#0f172a',
              color: '#ffffff'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingCart size={20} color="#34d399" />
                <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>Your Shopping Cart</span>
                <span style={{
                  backgroundColor: '#34d399',
                  color: '#0f172a',
                  padding: '1px 8px',
                  borderRadius: '999px',
                  fontSize: '0.72rem',
                  fontWeight: 800
                }}>
                  {cartItems.length} items
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCartDrawer(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Trial Notice & Indicator */}
            <div style={{
              padding: '0.75rem 1.25rem',
              background: '#f0fdf4',
              borderBottom: '1px solid #bbf7d0',
              fontSize: '0.80rem',
              color: '#15803d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>Selected for Home Trial: <strong>{trialCount} / 10 frames max</strong></span>
              {trialCount > 0 && <span style={{ fontWeight: 700 }}>✓ Ready for visit</span>}
            </div>

            {/* Cart Items List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              {cartItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#64748b' }}>
                  <ShoppingCart size={44} color="#cbd5e1" style={{ marginBottom: '1rem' }} />
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>Your cart is empty</div>
                  <p style={{ fontSize: '0.82rem', margin: '6px 0 1.2rem 0' }}>
                    Browse frames and add your favorites to order or select up to 10 for doorstep trial.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCartDrawer(false)}
                    style={{
                      padding: '0.55rem 1.2rem',
                      background: '#0d7665',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Explore Eyewear
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {cartItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        gap: '12px',
                        padding: '10px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        background: '#ffffff'
                      }}
                    >
                      <img
                        src={item.front_image}
                        alt={item.name}
                        style={{ width: '80px', height: '60px', objectFit: 'contain', background: '#f8fafc', borderRadius: '8px', padding: '4px' }}
                        onError={(e) => { e.target.src = '/frames/frame_001.svg'; }}
                      />

                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                          {item.brand}
                        </div>
                        <div style={{ fontSize: '0.90rem', fontWeight: 800, color: '#0f172a' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#0d7665', fontWeight: 700, marginTop: '2px' }}>
                          Supplier: {item.shop?.shop_name}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>
                            ₹{item.price}
                          </span>

                          {/* Quantity control */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f1f5f9', borderRadius: '6px', padding: '2px 6px' }}>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(item.id, Math.max(1, item.quantity - 1))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                            >
                              <Minus size={12} />
                            </button>
                            <span style={{ fontSize: '0.80rem', fontWeight: 800 }}>{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(item.id, item.quantity + 1)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Home Trial Selection Checkbox */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #e2e8f0' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={item.selected_for_trial}
                              onChange={() => handleToggleCartTrial(item.id, item.selected_for_trial)}
                              style={{ accentColor: '#0d7665', cursor: 'pointer' }}
                            />
                            <span>Include in Home Trial ({trialCount}/10)</span>
                          </label>

                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.id)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                            title="Remove from Cart"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cart Footer */}
            {cartItems.length > 0 && (
              <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem', color: '#64748b' }}>
                  <span>Total Frame Items:</span>
                  <span>{cartItems.reduce((acc, i) => acc + i.quantity, 0)} units</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                  <span>Subtotal:</span>
                  <span>₹{cartTotal}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {trialCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCartDrawer(false);
                        setServiceCategory('frame_trial');
                        setShowHomeServicesModal(true);
                      }}
                      style={{
                        padding: '0.75rem',
                        background: 'linear-gradient(135deg, #0284c7, #0d9488)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: 800,
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      <Home size={15} />
                      <span>Book Trial ({trialCount})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowCartDrawer(false);
                      setCheckoutModalOpen(true);
                    }}
                    style={{
                      gridColumn: trialCount > 0 ? 'auto' : '1 / -1',
                      padding: '0.75rem',
                      background: '#0d7665',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <CheckCircle2 size={16} />
                    <span>Proceed to Order</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------- MULTI-SHOP CHECKOUT MODAL ----------------- */}
      {checkoutModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '520px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                  Checkout & Confirm Order
                </h3>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  Items from different optical shops are divided and fulfilled directly.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {checkoutResult ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <CheckCircle2 size={48} color="#16a34a" style={{ marginBottom: '1rem' }} />
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.15rem' }}>
                  Orders Placed Successfully!
                </h4>
                <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  {checkoutResult.message}
                </p>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', textAlign: 'left', marginBottom: '1.5rem', fontSize: '0.82rem' }}>
                  {checkoutResult.orders?.map(o => (
                    <div key={o.order_number} style={{ marginBottom: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
                      <strong>{o.order_number}</strong>: {o.product_name} • ₹{o.total_amount} (Store: {o.shop_name})
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutModalOpen(false);
                    setCheckoutResult(null);
                  }}
                  style={{
                    padding: '0.65rem 1.5rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Close & View Portal
                </button>
              </div>
            ) : (
              <form onSubmit={handleCheckoutCart}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Full Delivery Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={checkoutForm.name}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, name: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                      Mobile Number *
                    </label>
                    <input
                      type="tel"
                      required
                      value={checkoutForm.mobile}
                      onChange={(e) => setCheckoutForm({ ...checkoutForm, mobile: e.target.value })}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      value={checkoutForm.email}
                      onChange={(e) => setCheckoutForm({ ...checkoutForm, email: e.target.value })}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Residential Address *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="House/Flat No., Apartment, Street, City, Pincode"
                    value={checkoutForm.address}
                    onChange={(e) => setCheckoutForm({ ...checkoutForm, address: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Prescription Options */}
                <div style={{ padding: '0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checkoutForm.has_prescription}
                      onChange={(e) => setCheckoutForm({ ...checkoutForm, has_prescription: e.target.checked })}
                      style={{ accentColor: '#0d7665', cursor: 'pointer' }}
                    />
                    <span>I want to attach my eye lens prescription</span>
                  </label>

                  {checkoutForm.has_prescription && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <input
                        type="text"
                        placeholder="Enter your prescription (e.g. OD: -1.50 SPH, OS: -1.25 SPH)"
                        value={checkoutForm.prescription_text}
                        onChange={(e) => setCheckoutForm({ ...checkoutForm, prescription_text: e.target.value })}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.80rem', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="submit"
                    disabled={checkoutSubmitting}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: '#0d7665',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    {checkoutSubmitting ? 'Placing Orders...' : `Confirm & Place Order (₹${cartTotal})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckoutModalOpen(false)}
                    style={{
                      padding: '0.75rem 1.25rem',
                      background: '#e2e8f0',
                      color: '#475569',
                      border: 'none',
                      borderRadius: '8px',
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
      )}

      {/* ----------------- TWO DISTINCT HOME SERVICES MODAL (Part 1 - Requirement 4) ----------------- */}
      {showHomeServicesModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '580px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Home size={20} color="#0d7665" />
                  <span>EyeReach Doorstep Home Services</span>
                </h3>
                <div style={{ fontSize: '0.80rem', color: '#64748b', marginTop: '2px' }}>
                  Book Frame Selection Home Visit, Home Vision Exam, or Both together.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHomeServicesModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Exactly Three Simple Service Choices (Correction 2) */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '8px',
              marginBottom: '1.25rem'
            }}>
              {/* Choice A: Frame Trial at Home */}
              <div
                onClick={() => setServiceCategory('frame_trial')}
                style={{
                  cursor: 'pointer',
                  border: serviceCategory === 'frame_trial' ? '2px solid #0d7665' : '1px solid #cbd5e1',
                  backgroundColor: serviceCategory === 'frame_trial' ? '#f0fdf4' : '#ffffff',
                  borderRadius: '10px',
                  padding: '0.85rem 0.65rem',
                  transition: 'all 0.2s ease',
                  textAlign: 'left',
                  boxShadow: serviceCategory === 'frame_trial' ? '0 2px 4px rgba(13, 118, 101, 0.15)' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '0.82rem', color: serviceCategory === 'frame_trial' ? '#0d7665' : '#1e293b' }}>
                  <Glasses size={17} color={serviceCategory === 'frame_trial' ? '#0d7665' : '#64748b'} />
                  <span>A. Frame Trial at Home</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', lineHeight: 1.35 }}>
                  Select up to 10 frames to try at home.
                </div>
              </div>

              {/* Choice B: Home Vision Test */}
              <div
                onClick={() => setServiceCategory('vision_test')}
                style={{
                  cursor: 'pointer',
                  border: serviceCategory === 'vision_test' ? '2px solid #0284c7' : '1px solid #cbd5e1',
                  backgroundColor: serviceCategory === 'vision_test' ? '#f0f9ff' : '#ffffff',
                  borderRadius: '10px',
                  padding: '0.85rem 0.65rem',
                  transition: 'all 0.2s ease',
                  textAlign: 'left',
                  boxShadow: serviceCategory === 'vision_test' ? '0 2px 4px rgba(2, 132, 199, 0.15)' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '0.82rem', color: serviceCategory === 'vision_test' ? '#0284c7' : '#1e293b' }}>
                  <Stethoscope size={17} color={serviceCategory === 'vision_test' ? '#0284c7' : '#64748b'} />
                  <span>B. Home Vision Test</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', lineHeight: 1.35 }}>
                  Existing Rx or new optometrist home exam.
                </div>
              </div>

              {/* Choice C: Both Services */}
              <div
                onClick={() => setServiceCategory('both')}
                style={{
                  cursor: 'pointer',
                  border: serviceCategory === 'both' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                  backgroundColor: serviceCategory === 'both' ? '#faf5ff' : '#ffffff',
                  borderRadius: '10px',
                  padding: '0.85rem 0.65rem',
                  transition: 'all 0.2s ease',
                  textAlign: 'left',
                  boxShadow: serviceCategory === 'both' ? '0 2px 4px rgba(124, 58, 237, 0.15)' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '0.82rem', color: serviceCategory === 'both' ? '#7c3aed' : '#1e293b' }}>
                  <Sparkles size={17} color={serviceCategory === 'both' ? '#7c3aed' : '#64748b'} />
                  <span>C. Both Services</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', lineHeight: 1.35 }}>
                  Trial 10 frames + Vision test combined.
                </div>
              </div>
            </div>

            {/* Strict Regulatory / Clinical Rules Notice */}
            <div style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              fontSize: '0.78rem',
              color: '#166534',
              marginBottom: '1.25rem',
              lineHeight: 1.45
            }}>
              <strong>Clinical Guarantee:</strong> Camera scan measurements assist with physical frame fit & temple reach only. The platform never claims camera images determine eye power. You are never forced to take a vision test if you have an existing prescription.
            </div>

            <form onSubmit={handleBookHomeService}>
              
              {/* Service A: Frame Selection Info (Choices A & C) */}
              {(serviceCategory === 'frame_trial' || serviceCategory === 'both') && (
                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.85rem',
                  marginBottom: '1rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Glasses size={16} color="#0d7665" />
                      <span>Frame Trial at Home (Up to 10 Frames)</span>
                    </div>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      background: '#dcfce7',
                      color: '#15803d',
                      padding: '2px 8px',
                      borderRadius: '10px'
                    }}>
                      {(cartItems.filter(i => i.selected_for_trial).length > 0 ? cartItems.filter(i => i.selected_for_trial) : picks).slice(0, 10).length} / 10 Selected
                    </span>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.65rem' }}>
                    A visiting optical representative will bring your selected frames directly to your home so you can try them on and finalize your preferred frame fit.
                  </div>

                  {/* Selected Frames Preview Thumbnails */}
                  {(cartItems.filter(i => i.selected_for_trial).length > 0 ? cartItems.filter(i => i.selected_for_trial) : picks).length > 0 ? (
                    <div style={{
                      display: 'flex',
                      gap: '8px',
                      overflowX: 'auto',
                      padding: '4px 0 6px 0'
                    }}>
                      {(cartItems.filter(i => i.selected_for_trial).length > 0 ? cartItems.filter(i => i.selected_for_trial) : picks).slice(0, 10).map((f, idx) => (
                        <div
                          key={f.product_id || idx}
                          style={{
                            flexShrink: 0,
                            width: '85px',
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            padding: '4px',
                            textAlign: 'center'
                          }}
                        >
                          {f.front_image ? (
                            <img src={f.front_image} alt={f.name} style={{ width: '100%', height: '36px', objectFit: 'contain' }} />
                          ) : (
                            <div style={{ height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Glasses size={18} color="#94a3b8" />
                            </div>
                          )}
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {f.name}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#0d7665', fontWeight: 800 }}>
                            ₹{f.price}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{
                      fontSize: '0.74rem',
                      color: '#b45309',
                      background: '#fffbeb',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid #fde68a'
                    }}>
                      Tip: You can select up to 10 frames from your Wishlist ❤️ or Cart ('Select for Home Trial') to try them at home.
                    </div>
                  )}
                </div>
              )}

              {/* Service B: Vision Test Options (Choices B & C) */}
              {(serviceCategory === 'vision_test' || serviceCategory === 'both') && (
                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.85rem',
                  marginBottom: '1rem'
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Stethoscope size={16} color="#0284c7" />
                    <span>Home Vision Test</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '0.85rem' }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: visionTestOption === 'existing_rx' ? '#e0f2fe' : '#ffffff',
                      border: visionTestOption === 'existing_rx' ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}>
                      <input
                        type="radio"
                        name="vision_test_opt"
                        checked={visionTestOption === 'existing_rx'}
                        onChange={() => setVisionTestOption('existing_rx')}
                        style={{ accentColor: '#0284c7' }}
                      />
                      <span>Option 1: Existing Prescription</span>
                    </label>

                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: visionTestOption === 'new_test' ? '#e0f2fe' : '#ffffff',
                      border: visionTestOption === 'new_test' ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}>
                      <input
                        type="radio"
                        name="vision_test_opt"
                        checked={visionTestOption === 'new_test'}
                        onChange={() => setVisionTestOption('new_test')}
                        style={{ accentColor: '#0284c7' }}
                      />
                      <span>Option 2: New Vision Exam at Home</span>
                    </label>
                  </div>

                  {visionTestOption === 'existing_rx' && (
                    <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                      <div style={{ fontSize: '0.74rem', color: '#0369a1', background: '#f0f9ff', padding: '0.5rem 0.65rem', borderRadius: '6px', marginBottom: '8px', border: '1px solid #bae6fd' }}>
                        Enter existing eye power or upload prescription. We will not force a new examination.
                      </div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                        Enter Eye Power (Optional if prescription uploaded):
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                        <input
                          type="number"
                          step="0.25"
                          placeholder="OD SPH"
                          value={homeServiceForm.sph_od}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, sph_od: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                        <input
                          type="number"
                          step="0.25"
                          placeholder="OD CYL"
                          value={homeServiceForm.cyl_od}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, cyl_od: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                        <input
                          type="number"
                          placeholder="OD AXIS"
                          value={homeServiceForm.axis_od}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, axis_od: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                        <input
                          type="number"
                          step="0.25"
                          placeholder="OD ADD"
                          value={homeServiceForm.add_od}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, add_od: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                        <input
                          type="number"
                          step="0.25"
                          placeholder="OS SPH"
                          value={homeServiceForm.sph_os}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, sph_os: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                        <input
                          type="number"
                          step="0.25"
                          placeholder="OS CYL"
                          value={homeServiceForm.cyl_os}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, cyl_os: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                        <input
                          type="number"
                          placeholder="OS AXIS"
                          value={homeServiceForm.axis_os}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, axis_os: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                        <input
                          type="number"
                          step="0.25"
                          placeholder="OS ADD"
                          value={homeServiceForm.add_os}
                          onChange={(e) => setHomeServiceForm({ ...homeServiceForm, add_os: e.target.value })}
                          style={{ padding: '0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                      </div>

                      {/* File Upload Option */}
                      <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #cbd5e1' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                          Upload Prescription (PDF or Image):
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="file"
                            accept=".pdf,image/*"
                            onChange={(e) => {
                              const file = e.target.files[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = () => {
                                  setHomeServiceForm(prev => ({
                                    ...prev,
                                    rx_file_url: reader.result,
                                    rx_notes: prev.rx_notes ? `${prev.rx_notes} (Attached: ${file.name})` : `Attached: ${file.name}`
                                  }));
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            style={{ fontSize: '0.75rem' }}
                          />
                          {homeServiceForm.rx_file_url && (
                            <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 700, background: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>
                              ✓ File Attached
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {visionTestOption === 'new_test' && (
                    <div style={{ fontSize: '0.78rem', color: '#0369a1', background: '#f0f9ff', padding: '0.65rem', borderRadius: '6px' }}>
                      Select an available appointment slot. A certified optometrist will visit with clinical refraction trial lenses to examine your eyes at home and issue a confirmed prescription.
                    </div>
                  )}
                </div>
              )}

              {/* Service C: Both Services Dual Appointment Notice */}
              {serviceCategory === 'both' && (
                <div style={{
                  background: '#faf5ff',
                  border: '1px solid #e9d5ff',
                  borderRadius: '8px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.76rem',
                  color: '#6b21a8',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <Sparkles size={15} color="#7c3aed" style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Two Independent Bookings:</strong> The system will create two distinct appointments (HS-FT for Frame Trial and HS-VT for Vision Exam) for independent status tracking.
                  </span>
                </div>
              )}

              {/* Date & Time Selection */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Preferred Date *
                  </label>
                  <input
                    type="date"
                    required
                    min={new Date().toISOString().split('T')[0]}
                    value={homeServiceForm.appointment_date}
                    onChange={(e) => {
                      const newD = e.target.value;
                      setHomeServiceForm({ ...homeServiceForm, appointment_date: newD });
                      fetchAvailableSlots(newD);
                    }}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Preferred Time Slot * {loadingSlots && <span style={{ fontSize: '0.70rem', color: '#0284c7', fontWeight: 500 }}>(Checking optometrists...)</span>}
                  </label>
                  <select
                    value={homeServiceForm.appointment_time}
                    onChange={(e) => setHomeServiceForm({ ...homeServiceForm, appointment_time: e.target.value })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', background: '#ffffff' }}
                  >
                    {availableSlots.length > 0 ? (
                      availableSlots.map(s => (
                        <option key={s.slot_time} value={s.slot_time} disabled={!s.is_available}>
                          {s.label} {s.is_available ? `(${s.remaining_capacity} available)` : '• FULLY BOOKED'}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="09:00 AM">09:00 AM - Morning Slot</option>
                        <option value="10:30 AM">10:30 AM - Morning Slot</option>
                        <option value="12:00 PM">12:00 PM - Midday Slot</option>
                        <option value="02:30 PM">02:30 PM - Afternoon Slot</option>
                        <option value="04:00 PM">04:00 PM - Evening Slot</option>
                        <option value="05:30 PM">05:30 PM - Evening Slot</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Residential Delivery Address */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Doorstep Residential Address *
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="Enter complete home address for visiting optical team"
                  value={homeServiceForm.home_address}
                  onChange={(e) => setHomeServiceForm({ ...homeServiceForm, home_address: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              {/* Optional Appointment / Delivery Notes */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Optional Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ring doorbell, landmark near garden, prefer afternoon"
                  value={homeServiceForm.additional_message}
                  onChange={(e) => setHomeServiceForm({ ...homeServiceForm, additional_message: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.80rem' }}
                />
              </div>

              {homeServiceMsg && (
                <div style={{
                  padding: '0.65rem',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  marginBottom: '1rem',
                  background: homeServiceMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                  color: homeServiceMsg.type === 'success' ? '#15803d' : '#b91c1c'
                }}>
                  {homeServiceMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="submit"
                  disabled={homeServiceSubmitting}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {homeServiceSubmitting
                    ? 'Submitting Request...'
                    : serviceCategory === 'frame_trial'
                    ? 'Book Frame Trial at Home'
                    : serviceCategory === 'vision_test'
                    ? 'Book Home Vision Test'
                    : 'Book Both Services'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowHomeServicesModal(false)}
                  style={{
                    padding: '0.75rem 1.25rem',
                    background: '#e2e8f0',
                    color: '#475569',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------- CUSTOMER ORDERS & DELIVERY TRACKING MODAL (Correction 1 & 8) ----------------- */}
      {showOrdersModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '720px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={22} color="#0d7665" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                    My Orders & Delivery Tracking
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    Live synchronization with optical shops from order dispatch to doorstep receipt
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={fetchCustomerOrders}
                  disabled={ordersLoading}
                  style={{
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                  title="Refresh Orders"
                >
                  <RotateCw size={13} className={ordersLoading ? 'animate-spin' : ''} />
                  <span>{ordersLoading ? 'Refreshing...' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowOrdersModal(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {ordersLoading && orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
                <RotateCw size={32} className="animate-spin" color="#0d7665" style={{ margin: '0 auto 0.75rem auto' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>Loading your orders...</div>
              </div>
            ) : orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: '#64748b' }}>
                <ShoppingBag size={48} color="#cbd5e1" style={{ margin: '0 auto 0.75rem auto', display: 'block' }} />
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>No orders placed yet</div>
                <p style={{ fontSize: '0.82rem', maxWidth: '380px', margin: '6px auto 1.25rem auto', lineHeight: 1.45 }}>
                  Browse our designer optical collection, try frames in 360° or Virtual Try-On, and place orders directly with partner optical shops.
                </p>
                <button
                  type="button"
                  onClick={() => setShowOrdersModal(false)}
                  style={{
                    padding: '0.6rem 1.2rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Explore Frame Catalog
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {orders.map((ord) => {
                  const currentStep = getOrderStatusStep(ord.status);
                  const isRejected = ord.status === 'Rejected' || ord.status === 'Cancelled';
                  const steps = [
                    { step: 1, label: 'Order Placed' },
                    { step: 2, label: 'Order Accepted' },
                    { step: 3, label: 'Preparing' },
                    { step: 4, label: 'Dispatched' },
                    { step: 5, label: 'Delivered' },
                    { step: 6, label: 'Customer Received' }
                  ];

                  return (
                    <div
                      key={ord.id}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                      }}
                    >
                      {/* Order Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '0.85rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
                              #{ord.order_number}
                            </span>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '0.70rem',
                              fontWeight: 800,
                              background: isRejected ? '#fee2e2' : ord.status === 'Customer Received' ? '#dcfce7' : ord.status === 'Delivered' ? '#dbeafe' : '#f0fdf4',
                              color: isRejected ? '#b91c1c' : ord.status === 'Customer Received' ? '#15803d' : ord.status === 'Delivered' ? '#1d4ed8' : '#0d7665',
                              border: `1px solid ${isRejected ? '#fca5a5' : ord.status === 'Customer Received' ? '#86efac' : ord.status === 'Delivered' ? '#93c5fd' : '#bbf7d0'}`
                            }}>
                              {ord.status}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span>Placed on {ord.created_at}</span>
                            <span>•</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                              <Store size={12} color="#0d7665" />
                              <strong>{ord.shop_name}</strong>
                            </span>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                            ₹{ord.total_amount}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            Qty: {ord.quantity} item{ord.quantity > 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>

                      {/* Product Preview Row */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        background: '#f8fafc',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        marginBottom: '1rem'
                      }}>
                        {ord.front_image ? (
                          <img
                            src={ord.front_image}
                            alt={ord.product_name}
                            style={{ width: '60px', height: '40px', objectFit: 'contain', borderRadius: '4px', background: '#ffffff', border: '1px solid #e2e8f0' }}
                          />
                        ) : (
                          <div style={{ width: '60px', height: '40px', background: '#e2e8f0', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Glasses size={22} color="#64748b" />
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ord.product_name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            Model: {ord.product_code || 'Standard'} {ord.is_home_trial ? '• Home Trial Order' : '• Doorstep Delivery'}
                          </div>
                        </div>
                        {ord.has_prescription && (
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#e0f2fe', color: '#0369a1', padding: '3px 7px', borderRadius: '4px', border: '1px solid #bae6fd' }}>
                            Prescription Included
                          </span>
                        )}
                      </div>

                      {/* Delivery Address */}
                      <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                        <MapPin size={13} color="#64748b" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span><strong>Deliver to:</strong> {ord.customer_address}</span>
                      </div>

                      {/* Rejection Alert */}
                      {isRejected && (
                        <div style={{
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '8px',
                          padding: '0.75rem',
                          fontSize: '0.78rem',
                          color: '#991b1b',
                          marginBottom: '0.5rem'
                        }}>
                          <strong>Order Status: Declined by Shop.</strong>
                          <div style={{ marginTop: '2px' }}>
                            Reason: {ord.rejection_reason || 'Frame temporarily out of stock. Please browse alternate frames.'}
                          </div>
                        </div>
                      )}

                      {/* 6-Stage Delivery Progress Stepper (Active Orders) */}
                      {!isRejected && (
                        <div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.6rem' }}>
                            Delivery Progression:
                          </div>

                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(6, 1fr)',
                            gap: '4px',
                            position: 'relative',
                            marginBottom: '1rem'
                          }}>
                            {steps.map((st) => {
                              const isCompleted = currentStep > st.step;
                              const isCurrent = currentStep === st.step;
                              const isPending = currentStep < st.step;

                              let circleBg = '#e2e8f0';
                              let circleColor = '#64748b';
                              let circleBorder = '2px solid #cbd5e1';
                              let textWeight = 500;
                              let textColor = '#64748b';

                              if (isCompleted) {
                                circleBg = '#0d7665';
                                circleColor = '#ffffff';
                                circleBorder = '2px solid #0d7665';
                                textColor = '#0d7665';
                                textWeight = 700;
                              } else if (isCurrent) {
                                circleBg = '#ffffff';
                                circleColor = '#0d7665';
                                circleBorder = '2.5px solid #0d7665';
                                textColor = '#0f172a';
                                textWeight = 800;
                              }

                              return (
                                <div key={st.step} style={{ textAlign: 'center', position: 'relative' }}>
                                  <div style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    background: circleBg,
                                    color: circleColor,
                                    border: circleBorder,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 6px auto',
                                    fontSize: '0.70rem',
                                    fontWeight: 800,
                                    transition: 'all 0.2s ease',
                                    boxShadow: isCurrent ? '0 0 0 4px rgba(13, 118, 101, 0.15)' : 'none'
                                  }}>
                                    {isCompleted ? <Check size={14} /> : st.step}
                                  </div>
                                  <div style={{
                                    fontSize: '0.68rem',
                                    fontWeight: textWeight,
                                    color: textColor,
                                    lineHeight: 1.2
                                  }}>
                                    {st.label}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Delivery Receipt Confirmation Action */}
                          {currentStep === 5 && (
                            <div style={{
                              background: '#f0fdf4',
                              border: '1px solid #86efac',
                              borderRadius: '8px',
                              padding: '0.85rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
                              gap: '10px'
                            }}>
                              <div>
                                <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#166534' }}>
                                  Package Delivered to Your Address!
                                </div>
                                <div style={{ fontSize: '0.74rem', color: '#15803d' }}>
                                  Please inspect your frames and tap below to confirm delivery receipt.
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleConfirmDelivery(ord.id)}
                                disabled={confirmingOrderId === ord.id}
                                style={{
                                  background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '8px',
                                  padding: '0.55rem 1rem',
                                  fontSize: '0.78rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  boxShadow: '0 2px 4px rgba(13, 118, 101, 0.2)'
                                }}
                              >
                                <CheckCircle2 size={15} />
                                <span>{confirmingOrderId === ord.id ? 'Confirming Receipt...' : 'Confirm Delivery / Customer Received'}</span>
                              </button>
                            </div>
                          )}

                          {/* Customer Received Confirmation Badge */}
                          {currentStep === 6 && (
                            <div style={{
                              background: '#ecfdf5',
                              border: '1px solid #a7f3d0',
                              borderRadius: '8px',
                              padding: '0.7rem 0.85rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '0.78rem',
                              color: '#065f46',
                              fontWeight: 700
                            }}>
                              <CheckCircle2 size={18} color="#059669" />
                              <span>✓ Order Complete: Verified as Customer Received. Thank you for choosing EyeReach!</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------- CUSTOMER NOTIFICATIONS MODAL (Part 3) ----------------- */}
      {showNotificationsModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '500px',
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            padding: '1.5rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={20} color="#0d7665" />
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  Notifications & Reminders
                </h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {unreadNotifsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllNotifsRead}
                    style={{ background: 'none', border: 'none', color: '#0d7665', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNotificationsModal(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {notifications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
                <Bell size={40} color="#cbd5e1" style={{ marginBottom: '0.75rem' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>No notifications yet</div>
                <p style={{ fontSize: '0.80rem', margin: '4px 0 0 0' }}>
                  Order progression, home trial updates, and optometrist prescriptions will appear here.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => { if (!n.is_read) handleMarkNotifRead(n.id); }}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '10px',
                      background: n.is_read ? '#ffffff' : '#f0fdf4',
                      border: n.is_read ? '1px solid #e2e8f0' : '1.5px solid #86efac',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3px' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a' }}>
                        {n.title}
                      </span>
                      <span style={{ fontSize: '0.70rem', color: '#94a3b8' }}>
                        {n.created_at}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.80rem', color: '#475569', lineHeight: 1.4 }}>
                      {n.message}
                    </div>

                    {n.notification_type === 'reminder' && (
                      <div style={{ marginTop: '6px' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowNotificationsModal(false);
                            setServiceCategory('vision_test');
                            setShowHomeServicesModal(true);
                          }}
                          style={{
                            padding: '0.35rem 0.75rem',
                            background: '#0d7665',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Book Routine Vision Exam →
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------- CUSTOMER PROFILE MODAL (Part 1 - Requirement 1) ----------------- */}
      {showProfileModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '480px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={20} color="#0d7665" />
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                  Customer Profile & Address
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  value={profileForm.mobile}
                  onChange={(e) => setProfileForm({ ...profileForm, mobile: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Residential Address *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Flat/House No., Street, Locality, City, Pincode"
                  value={profileForm.address}
                  onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              {profileMsg && (
                <div style={{
                  padding: '0.6rem',
                  borderRadius: '6px',
                  fontSize: '0.80rem',
                  marginBottom: '1rem',
                  background: profileMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                  color: profileMsg.type === 'success' ? '#15803d' : '#b91c1c'
                }}>
                  {profileMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="submit"
                  disabled={profileSaving}
                  style={{
                    flex: 1,
                    padding: '0.7rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {profileSaving ? 'Saving...' : 'Save Profile Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  style={{
                    padding: '0.7rem 1.25rem',
                    background: '#e2e8f0',
                    color: '#475569',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------- APPOINTMENT RESCHEDULING MODAL (Requirement 5) ----------------- */}
      {rescheduleModalAppt && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '460px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={20} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                  Reschedule Appointment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleModalAppt(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ margin: '0 0 1rem 0', color: '#64748b', fontSize: '0.84rem' }}>
              Select a new date and available time slot for appointment #{rescheduleModalAppt.appointment_id}.
            </p>

            <form onSubmit={handleRescheduleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  New Date *
                </label>
                <input
                  type="date"
                  required
                  min={new Date().toISOString().split('T')[0]}
                  value={rescheduleDate}
                  onChange={(e) => {
                    const newD = e.target.value;
                    setRescheduleDate(newD);
                    fetchRescheduleSlots(newD, rescheduleModalAppt.shop_id);
                  }}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Available Time Slot *
                </label>
                <select
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', background: '#ffffff' }}
                >
                  {rescheduleSlots.length > 0 ? (
                    rescheduleSlots.map(s => (
                      <option key={s.slot_time} value={s.slot_time} disabled={!s.is_available}>
                        {s.label} {s.is_available ? `(${s.remaining_capacity} available)` : '• FULLY BOOKED'}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="09:00 AM">09:00 AM - Morning Slot</option>
                      <option value="10:30 AM">10:30 AM - Morning Slot</option>
                      <option value="12:00 PM">12:00 PM - Midday Slot</option>
                      <option value="02:30 PM">02:30 PM - Afternoon Slot</option>
                      <option value="04:00 PM">04:00 PM - Evening Slot</option>
                      <option value="05:30 PM">05:30 PM - Evening Slot</option>
                    </>
                  )}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="submit"
                  disabled={rescheduleLoading}
                  style={{
                    flex: 1,
                    padding: '0.7rem',
                    background: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    cursor: rescheduleLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {rescheduleLoading ? 'Confirming...' : 'Confirm Reschedule'}
                </button>
                <button
                  type="button"
                  onClick={() => setRescheduleModalAppt(null)}
                  style={{
                    padding: '0.7rem 1.25rem',
                    background: '#e2e8f0',
                    color: '#475569',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------- APPOINTMENT CANCELLATION CONFIRMATION MODAL ----------------- */}
      {cancelModalAppt && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '440px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 800, color: '#b91c1c' }}>
              Cancel Appointment #{cancelModalAppt.appointment_id}?
            </h3>
            <p style={{ margin: '0 0 1.25rem 0', color: '#64748b', fontSize: '0.85rem', lineHeight: 1.45 }}>
              Are you sure you want to cancel this visit scheduled for <strong>{cancelModalAppt.appointment_date}</strong> at <strong>{cancelModalAppt.appointment_time}</strong>? The reserved optometrist slot will be released back to the store.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setCancelModalAppt(null)}
                style={{
                  padding: '0.65rem 1.15rem',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  color: '#475569',
                  cursor: 'pointer'
                }}
              >
                Keep Appointment
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => handleCancelAppointment(cancelModalAppt.id)}
                style={{
                  padding: '0.65rem 1.25rem',
                  background: '#e11d48',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: cancelling ? 'not-allowed' : 'pointer'
                }}
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        onAddToCart={(prod) => {
          handleAddToCart(prod);
          setSelectedProductForDetail(null);
        }}
        onTryOn={(prod) => {
          setSelectedProductForDetail(null);
          onOpenTryOn(prod);
        }}
        onOrderSuccess={() => {
          setSelectedProductForDetail(null);
          fetchProducts();
          fetchCart();
        }}
      />

    </div>
  );
}
