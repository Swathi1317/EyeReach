import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  LayoutDashboard,
  Glasses,
  PlusCircle,
  UploadCloud,
  Wand2,
  ShoppingBag,
  Users,
  BarChart3,
  Store,
  Settings,
  LogOut,
  Search,
  Filter,
  Trash2,
  Edit,
  DollarSign,
  Package,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  Download,
  Sparkles,
  ArrowRight,
  TrendingUp,
  RefreshCw,
  Eye,
  Info,
  ShieldCheck,
  Stethoscope,
  CheckCircle2,
  X
} from 'lucide-react';

const getAuthHeaders = () => {
  const token = localStorage.getItem('smartframe_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function ShopDashboard({ shopUser, onLogout, onSwitchToCustomer }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [shapeFilter, setShapeFilter] = useState('All');
  const [genderFilter, setGenderFilter] = useState('All');
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);

  // Doctor Management State
  const [doctors, setDoctors] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [showAddDoctorModal, setShowAddDoctorModal] = useState(false);
  const [newDoctorForm, setNewDoctorForm] = useState({
    name: '',
    email: '',
    mobile: '',
    specialization: 'Optometrist & Ophthalmic Dispenser',
    qualification: 'M.Optom, FAAO',
    registration_number: '',
    password: ''
  });
  const [doctorSubmitMsg, setDoctorSubmitMsg] = useState(null);

  // Edit Frame State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editSubmitMsg, setEditSubmitMsg] = useState(null);

  // Real Spectacles Gallery Picker State
  const [realGallery, setRealGallery] = useState([]);
  const [showGalleryPicker, setShowGalleryPicker] = useState(false);
  const [galleryTarget, setGalleryTarget] = useState('add'); // 'add' | 'edit'

  // Owner Password Change State
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  const [passwordMsg, setPasswordMsg] = useState(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Customer Frame Preferences State
  const [preferencesData, setPreferencesData] = useState(null);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [homeAppointments, setHomeAppointments] = useState([]);

  // Single Frame Form State
  const [singleForm, setSingleForm] = useState({
    product_id: '',
    brand: '',
    name: '',
    shape: 'Round',
    material: 'Acetate',
    color: 'Black',
    frame_type: 'Full Rim',
    size: '50-18-140',
    lens_width_mm: 50,
    bridge_width_mm: 18,
    temple_length_mm: 140,
    price: 1800,
    stock_quantity: 10,
    gender_category: 'Unisex',
    description: '',
    front_image: '/frames/kaggle/0_mt6960_0.png',
    side_image: '/frames/kaggle/0_mt6960_0.png',
    angled_image: '/frames/kaggle/0_mt6960_0.png'
  });
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const [singleSubmitMsg, setSingleSubmitMsg] = useState(null);

  // Bulk Upload State
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkReport, setBulkReport] = useState(null);

  // AI Generator State
  const [aiPrompt, setAiPrompt] = useState('Generate a classic rectangular spectacle frame in deep matte black, full rim, crafted from premium Italian acetate with modern minimalist appeal.');
  const [aiShape, setAiShape] = useState('Rectangle');
  const [aiColor, setAiColor] = useState('Black');
  const [aiMaterial, setAiMaterial] = useState('Acetate');
  const [aiFrameType, setAiFrameType] = useState('Full Rim');
  const [aiGender, setAiGender] = useState('Unisex');
  const [aiStyle, setAiStyle] = useState('Modern');
  const [aiSize, setAiSize] = useState('Medium');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState(null);
  const [approveMsg, setApproveMsg] = useState(null);

  // Profile Form State
  const [profileForm, setProfileForm] = useState({
    owner_name: shopUser?.owner_name || '',
    shop_name: shopUser?.shop_name || '',
    mobile_number: shopUser?.mobile_number || '',
    shop_address: shopUser?.shop_address || ''
  });
  const [profileMsg, setProfileMsg] = useState(null);

  // Fetch Dashboard Stats
  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const res = await axios.get('/api/shop/dashboard/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  // Fetch Products
  const fetchProducts = async () => {
    setLoadingProducts(true);
    try {
      const res = await axios.get('/api/shop/products', {
        params: {
          search: searchQuery || undefined,
          shape: shapeFilter !== 'All' ? shapeFilter : undefined,
          gender: genderFilter !== 'All' ? genderFilter : undefined
        }
      });
      setProducts(res.data.products || []);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoadingProducts(false);
    }
  };

  // Fetch Orders
  const fetchOrders = async () => {
    try {
      const res = await axios.get('/api/shop/orders');
      setOrders(res.data || []);
    } catch (err) {
      console.error('Error fetching orders:', err);
    }
  };

  // Fetch Customers
  const fetchCustomers = async () => {
    try {
      const res = await axios.get('/api/shop/customers');
      setCustomers(res.data || []);
    } catch (err) {
      console.error('Error fetching customers:', err);
    }
  };

  // Fetch Customer Frame Preferences (Aggregate Demand & Home Appointments)
  const fetchCustomerPreferences = async () => {
    setLoadingPreferences(true);
    try {
      const [prefRes, apptRes] = await Promise.all([
        axios.get('/api/shop/customer-frame-preferences'),
        axios.get('/api/shop/home-appointments')
      ]);
      setPreferencesData(prefRes.data);
      setHomeAppointments(apptRes.data?.appointments || []);
    } catch (err) {
      console.error('Error fetching customer preferences:', err);
    } finally {
      setLoadingPreferences(false);
    }
  };

  const fetchDoctors = async () => {
    setLoadingDoctors(true);
    try {
      const res = await axios.get('/api/shop/doctors', { headers: getAuthHeaders() });
      setDoctors(res.data.doctors || []);
    } catch (err) {
      console.error('Error fetching doctors:', err);
    } finally {
      setLoadingDoctors(false);
    }
  };

  const fetchRealGallery = async () => {
    try {
      const res = await axios.get('/api/shop/real-frames-gallery');
      setRealGallery(res.data.images || []);
    } catch (err) {
      console.error('Error fetching real frames gallery:', err);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchProducts();
    fetchOrders();
    fetchCustomers();
    fetchCustomerPreferences();
    fetchDoctors();
    fetchRealGallery();
  }, []);

  useEffect(() => {
    if (activeTab === 'inventory') {
      fetchProducts();
    } else if (activeTab === 'dashboard') {
      fetchStats();
    } else if (activeTab === 'orders') {
      fetchOrders();
    } else if (activeTab === 'customers') {
      fetchCustomers();
    } else if (activeTab === 'preferences') {
      fetchCustomerPreferences();
    } else if (activeTab === 'doctors') {
      fetchDoctors();
    }
  }, [activeTab, shapeFilter, genderFilter]);

  // Handle AI Description Generation
  const handleGenerateDescription = async () => {
    setAiDescLoading(true);
    try {
      const res = await axios.post('/api/shop/ai/generate-description', {
        brand: singleForm.brand || 'EyeReach Studio',
        shape: singleForm.shape,
        material: singleForm.material,
        color: singleForm.color,
        frame_type: singleForm.frame_type,
        size: singleForm.size,
        gender: singleForm.gender_category
      }, { headers: getAuthHeaders() });
      setSingleForm((prev) => ({
        ...prev,
        description: res.data.description
      }));
    } catch (err) {
      alert('Failed to generate AI description.');
    } finally {
      setAiDescLoading(false);
    }
  };

  // Handle Single Frame Submit (Requirement 1 - Real spectacle frames only)
  const handleSingleSubmit = async (e) => {
    e.preventDefault();
    setSingleSubmitMsg(null);
    try {
      const res = await axios.post('/api/shop/products', singleForm, { headers: getAuthHeaders() });
      setSingleSubmitMsg({ type: 'success', text: res.data.message || 'Frame added successfully to store inventory!' });
      fetchProducts();
      fetchStats();
      // Reset form with real optical photo default
      setSingleForm({
        product_id: '',
        brand: '',
        name: '',
        shape: 'Round',
        material: 'Acetate',
        color: 'Black',
        frame_type: 'Full Rim',
        size: '50-18-140',
        lens_width_mm: 50,
        bridge_width_mm: 18,
        temple_length_mm: 140,
        price: 1800,
        stock_quantity: 10,
        gender_category: 'Unisex',
        description: '',
        front_image: '/frames/kaggle/0_mt6960_0.png',
        side_image: '/frames/kaggle/0_mt6960_0.png',
        angled_image: '/frames/kaggle/0_mt6960_0.png'
      });
    } catch (err) {
      setSingleSubmitMsg({
        type: 'error',
        text: err.response?.data?.detail || 'Failed to add frame.'
      });
    }
  };

  // Edit Product Submit
  const handleOpenEditModal = (p) => {
    setEditingProduct({
      id: p.id,
      product_id: p.product_id,
      name: p.name,
      brand: p.brand,
      shape: p.shape,
      material: p.material,
      color: p.color,
      frame_type: p.frame_type || 'Full Rim',
      price: p.price,
      stock_quantity: p.stock_quantity != null ? p.stock_quantity : 10,
      lens_width_mm: p.lens_width_mm || 50,
      bridge_width_mm: p.bridge_width_mm || 18,
      temple_length_mm: p.temple_length_mm || 140,
      front_image: p.front_image,
      description: p.description || ''
    });
    setEditSubmitMsg(null);
    setEditModalOpen(true);
  };

  const handleEditProductSubmit = async (e) => {
    e.preventDefault();
    setEditSubmitMsg(null);
    try {
      await axios.put(`/api/shop/products/${editingProduct.id}`, editingProduct, { headers: getAuthHeaders() });
      setEditSubmitMsg({ type: 'success', text: 'Frame details updated successfully!' });
      fetchProducts();
      fetchStats();
      setTimeout(() => {
        setEditModalOpen(false);
        setEditSubmitMsg(null);
      }, 1200);
    } catch (err) {
      setEditSubmitMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to update frame.' });
    }
  };

  // Handle Bulk Upload
  const handleBulkUpload = async (e) => {
    e.preventDefault();
    if (!bulkFile) return;

    setBulkUploading(true);
    setBulkReport(null);

    const formData = new FormData();
    formData.append('file', bulkFile);

    try {
      const res = await axios.post('/api/shop/products/bulk-upload', formData, { headers: getAuthHeaders() });
      setBulkReport(res.data);
      fetchProducts();
      fetchStats();
    } catch (err) {
      setBulkReport({
        status: 'error',
        message: err.response?.data?.detail || 'Upload failed.'
      });
    } finally {
      setBulkUploading(false);
    }
  };

  // Handle AI Frame Image Generation
  const handleGenerateFrame = async (e) => {
    e.preventDefault();
    setAiGenerating(true);
    setApproveMsg(null);
    try {
      const res = await axios.post('/api/shop/ai/generate-frame-image', {
        prompt: aiPrompt,
        shape: aiShape,
        color: aiColor,
        material: aiMaterial,
        frame_type: aiFrameType,
        gender: aiGender,
        design_style: aiStyle,
        size: aiSize
      }, { headers: getAuthHeaders() });
      setGeneratedResult(res.data);
    } catch (err) {
      alert('Failed to generate frame image.');
    } finally {
      setAiGenerating(false);
    }
  };

  // Approve & Save AI Frame
  const handleApproveSave = async () => {
    if (!generatedResult) return;
    setApproveMsg(null);
    try {
      const pId = `AI-${Math.floor(1000 + Math.random() * 9000)}`;
      const res = await axios.post('/api/shop/ai/approve-and-save', {
        product_id: pId,
        brand: 'EyeReach Studio',
        name: `${generatedResult.specs?.color || ''} ${generatedResult.specs?.shape || 'Eyewear'}`,
        shape: generatedResult.specs?.shape || 'Rectangle',
        material: generatedResult.specs?.material || 'Acetate',
        color: generatedResult.specs?.color || 'Black',
        frame_type: generatedResult.specs?.frame_type || 'Full Rim',
        size: '52-18-140',
        price: 2499,
        stock_quantity: 8,
        gender_category: 'Unisex',
        description: `AI-Synthesized spectacle frame. ${generatedResult.prompt_interpreted}`,
        image_url: generatedResult.image_url
      }, { headers: getAuthHeaders() });

      setApproveMsg({ type: 'success', text: res.data.message });
      fetchProducts();
      fetchStats();
    } catch (err) {
      setApproveMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to save product.' });
    }
  };

  // Delete product (Requirement 1 - Fix deleting frames safely)
  const handleDeleteProduct = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete frame "${name}" (ID: ${id}) from store catalog?`)) return;
    try {
      const res = await axios.delete(`/api/shop/products/${id}`, { headers: getAuthHeaders() });
      alert(res.data?.message || `Frame "${name}" was deleted successfully.`);
      fetchProducts();
      fetchStats();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete product.');
    }
  };

  // Add & Link Doctor (Requirement 3)
  const handleAddDoctorSubmit = async (e) => {
    e.preventDefault();
    setDoctorSubmitMsg(null);
    try {
      await axios.post('/api/shop/doctors', newDoctorForm, { headers: getAuthHeaders() });
      setDoctorSubmitMsg({ type: 'success', text: 'Doctor / Optometrist added and linked successfully!' });
      fetchDoctors();
      setNewDoctorForm({
        name: '',
        email: '',
        mobile: '',
        specialization: 'Optometrist & Ophthalmic Dispenser',
        qualification: 'M.Optom, FAAO',
        registration_number: '',
        password: ''
      });
      setTimeout(() => {
        setShowAddDoctorModal(false);
        setDoctorSubmitMsg(null);
      }, 1500);
    } catch (err) {
      setDoctorSubmitMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to link doctor.' });
    }
  };

  // Assign Doctor to Appointment (Requirement 3)
  const handleAssignDoctor = async (appointmentId, doctorId) => {
    try {
      await axios.put(
        `/api/shop/appointments/${appointmentId}/assign`,
        { doctor_id: doctorId },
        { headers: getAuthHeaders() }
      );
      fetchCustomerPreferences();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to assign doctor.');
    }
  };

  // Owner Change Password (Requirement 8)
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (!passwordForm.current_password || !passwordForm.new_password) {
      setPasswordMsg({ type: 'error', text: 'Please fill in all password fields.' });
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMsg({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }
    setPasswordLoading(true);
    try {
      await axios.put(
        '/api/shop/password',
        {
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password
        },
        { headers: getAuthHeaders() }
      );
      setPasswordMsg({ type: 'success', text: 'Owner password updated successfully!' });
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setPasswordMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to change password.' });
    } finally {
      setPasswordLoading(false);
    }
  };

  // Update order status
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      await axios.patch(`/api/shop/orders/${orderId}/status`, { status: newStatus }, { headers: getAuthHeaders() });
      fetchOrders();
      fetchStats();
    } catch (err) {
      alert('Failed to update status.');
    }
  };

  // Update Profile (Requirement 8)
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileMsg(null);
    try {
      const res = await axios.put('/api/shop/profile', profileForm, { headers: getAuthHeaders() });
      setProfileMsg({ type: 'success', text: res.data?.message || 'Store profile saved successfully!' });
      fetchStats();
    } catch (err) {
      setProfileMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to update store profile.' });
    }
  };

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'preferences', label: 'Customer Frame Preferences', icon: Glasses },
    { id: 'inventory', label: 'Frame Inventory', icon: Glasses },
    { id: 'add_frame', label: 'Add New Frame', icon: PlusCircle },
    { id: 'doctors', label: 'Doctors & Optometrists', icon: Stethoscope },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'analytics', label: 'Store Analytics', icon: BarChart3 },
    { id: 'profile', label: 'Shop Profile', icon: Store },
    { id: 'settings', label: 'Owner Settings', icon: Settings }
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* SIDEBAR NAVIGATION (Module 2: 10 Sidebar Items) */}
      <aside style={{
        width: '260px',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #1e293b',
        flexShrink: 0
      }}>
        {/* Brand Header */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #0d7665, #0f766e)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            boxShadow: '0 4px 10px rgba(13, 118, 101, 0.3)'
          }}>
            👓
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em', color: '#ffffff' }}>
              EyeReach – Home Testing App
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
              Optical Store OS
            </div>
          </div>
        </div>

        {/* Current Store Badge */}
        <div style={{
          padding: '0.85rem 1.25rem',
          backgroundColor: '#1e293b',
          margin: '0.75rem',
          borderRadius: '10px',
          border: '1px solid #334155'
        }}>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
            Active Optical Store
          </div>
          <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#38bdf8', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stats?.shop_name || shopUser?.shop_name || 'VisionCraft Optics'}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#a7f3d0', marginTop: '2px', fontWeight: 600 }}>
            Plan: {shopUser?.subscription_plan || 'Pro Store'}
          </div>
        </div>

        {/* Nav Items List */}
        <nav style={{ flex: 1, padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: isActive ? '#0d7665' : 'transparent',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease, color 0.15s ease'
                }}
                onMouseOver={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
                onMouseOut={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Actions: Switch to Customer Portal / Logout */}
        <div style={{ padding: '0.75rem', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            onClick={onSwitchToCustomer}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '0.65rem',
              borderRadius: '8px',
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            <Eye size={16} />
            <span>Switch to Customer App</span>
          </button>

          <button
            onClick={onLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '0.65rem',
              borderRadius: '8px',
              background: 'transparent',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        
        {/* Top Navbar */}
        <header style={{
          height: '64px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 2rem',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
              {menuItems.find((m) => m.id === activeTab)?.label}
            </h1>
            <span style={{ fontSize: '0.80rem', color: '#64748b' }}>
              • {stats?.shop_name || 'VisionCraft Opticians'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: '#0d7665',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '0.90rem'
              }}>
                {(shopUser?.owner_name || 'R')[0]}
              </div>
              <div style={{ fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{shopUser?.owner_name || 'Rajesh Sharma'}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Store Owner</div>
              </div>
            </div>
          </div>
        </header>

        {/* Tab Content Body */}
        <div style={{ padding: '2rem', flex: 1 }}>

          {/* TAB 1: MODULE 2 - DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div>
              {/* KPI Cards Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '2rem'
              }}>
                <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Total Products</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0f172a', margin: '4px 0' }}>
                    {stats?.total_products || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#0d7665', fontWeight: 600 }}>Active catalog items</div>
                </div>

                <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Total Frames in Stock</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0284c7', margin: '4px 0' }}>
                    {stats?.total_frames || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Total physical units</div>
                </div>

                <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Available Stock Units</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#16a34a', margin: '4px 0' }}>
                    {stats?.available_stock || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 600 }}>Ready to dispense</div>
                </div>

                <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Out-of-Stock Products</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: (stats?.out_of_stock_products || 0) > 0 ? '#ef4444' : '#64748b', margin: '4px 0' }}>
                    {stats?.out_of_stock_products || 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#dc2626' }}>Requires reorder</div>
                </div>

                <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Total Sales Revenue</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#0d7665', margin: '4px 0' }}>
                    ₹{(stats?.sales_overview?.total_revenue || 0).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#0d7665', fontWeight: 600 }}>Store orders fulfilled</div>
                </div>
              </div>

              {/* Middle Section: Recent Orders & Product Categories */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                {/* Recent Orders Card */}
                <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Recent Customer Orders</h3>
                    <button
                      onClick={() => setActiveTab('orders')}
                      style={{ background: 'none', border: 'none', color: '#0d7665', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
                    >
                      View All →
                    </button>
                  </div>

                  {(!stats?.recent_orders || stats.recent_orders.length === 0) ? (
                    <div style={{ color: '#64748b', fontSize: '0.88rem', padding: '1rem 0' }}>No customer orders placed yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {stats.recent_orders.map((o) => (
                        <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: '#f8fafc', borderRadius: '8px' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f172a' }}>{o.product_name}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>By {o.customer_name} • {o.order_number}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, fontSize: '0.90rem', color: '#0f172a' }}>₹{o.total_amount}</div>
                            <span style={{
                              fontSize: '0.70rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: o.status === 'Completed' ? '#dcfce7' : '#e0f2fe',
                              color: o.status === 'Completed' ? '#15803d' : '#0369a1'
                            }}>
                              {o.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Categories Breakdown */}
                <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                    Frame Shapes Distribution
                  </h3>
                  {stats?.product_categories && Object.keys(stats.product_categories).length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {Object.entries(stats.product_categories).map(([cat, count]) => {
                        const total = stats.total_products || 1;
                        const pct = Math.round((count / total) * 100);
                        return (
                          <div key={cat}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                              <strong style={{ color: '#0f172a' }}>{cat}</strong>
                              <span style={{ color: '#64748b' }}>{count} items ({pct}%)</span>
                            </div>
                            <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: '#0d7665', borderRadius: '4px' }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: '#64748b', fontSize: '0.88rem' }}>No inventory categories available.</div>
                  )}
                </div>
              </div>

              {/* Quick Action Shortcuts Banner */}
              <div style={{
                background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                borderRadius: '12px',
                padding: '1.5rem 2rem',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem'
              }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Expand Your Store Inventory</h4>
                  <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: '#a7f3d0' }}>
                    Upload individual frames, bulk import via Excel spreadsheet, or synthesize new eyewear models using AI.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setActiveTab('add_frame')}
                    style={{ padding: '0.65rem 1rem', background: '#ffffff', color: '#0d7665', border: 'none', borderRadius: '8px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer' }}
                  >
                    + Add New Frame
                  </button>
                  <button
                    onClick={() => setActiveTab('ai_generator')}
                    style={{ padding: '0.65rem 1rem', background: 'rgba(255,255,255,0.2)', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer' }}
                  >
                    ✨ AI Generator
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: CUSTOMER FRAME PREFERENCES (DEMAND ANALYTICS & PRIVACY-PROTECTED LIKES) */}
          {activeTab === 'preferences' && (
            <div>
              {/* Customer Privacy Protection Notice */}
              <div style={{
                backgroundColor: '#f0fdfa',
                border: '1px solid #99f6e4',
                borderRadius: '16px',
                padding: '1.25rem 1.5rem',
                marginBottom: '1.75rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '14px',
                boxShadow: '0 4px 14px rgba(13, 148, 136, 0.05)'
              }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  backgroundColor: '#0d9488',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <ShieldCheck size={24} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: '0.96rem', color: '#0f766e' }}>
                      Customer Privacy Protection Protocol Active
                    </span>
                    <span style={{
                      backgroundColor: '#ccfbf1',
                      color: '#0f766e',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      textTransform: 'uppercase'
                    }}>
                      Aggregate Statistics Only
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: '#475569', lineHeight: 1.45 }}>
                    This section displays aggregated customer demand data derived from real customer selections saved in "EyeReach Collection". Zero private customer identifiers (such as customer names, phone numbers, or private home addresses) are exposed to shopkeepers without customer consent.
                  </p>
                </div>
              </div>

              {loadingPreferences ? (
                <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
                  Loading customer frame preferences and aggregate demand data...
                </div>
              ) : (
                <>
                  {/* Top Aggregate KPI Metrics */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                    gap: '1rem',
                    marginBottom: '2rem'
                  }}>
                    <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Total Frame Views</span>
                        <Eye size={18} color="#0284c7" />
                      </div>
                      <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#0284c7', margin: '4px 0' }}>
                        {preferencesData?.total_views || 0}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Catalogue & 3D Try-On views</div>
                    </div>

                    <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Total Frame Selections</span>
                        <Glasses size={18} color="#059669" />
                      </div>
                      <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#059669', margin: '4px 0' }}>
                        {preferencesData?.total_selections || 0}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Collection picks & home trials</div>
                    </div>

                    <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Top Trending Shape</span>
                        <Glasses size={18} color="#0d9488" />
                      </div>
                      <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#0d9488', margin: '4px 0' }}>
                        {preferencesData?.popular_shapes?.[0]?.shape || 'Round'}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#0f766e', fontWeight: 600 }}>
                        {preferencesData?.popular_shapes?.[0]?.likes || 0} customer preferences
                      </div>
                    </div>

                    <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.80rem', fontWeight: 600, color: '#64748b' }}>Top Trending Colour</span>
                        <Sparkles size={18} color="#f59e0b" />
                      </div>
                      <div style={{ fontSize: '1.9rem', fontWeight: 900, color: '#b45309', margin: '4px 0' }}>
                        {preferencesData?.popular_colors?.[0]?.color || 'Black'}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 600 }}>
                        {preferencesData?.popular_colors?.[0]?.likes || 0} customer preferences
                      </div>
                    </div>
                  </div>

                  {/* Combination of Popular Shapes and Colours */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    padding: '1.5rem',
                    marginBottom: '2rem',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                          Combination of Popular Shapes & Colours
                        </h3>
                        <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                          Combined customer demand rankings showing preferred shape + colour pairs.
                        </p>
                      </div>
                      <span style={{
                        backgroundColor: '#f1f5f9',
                        color: '#475569',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        Real Database Statistics
                      </span>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '1rem'
                    }}>
                      {(preferencesData?.top_combinations || []).map((combo, idx) => {
                        const colors = ['#0d9488', '#0284c7', '#d97706', '#7c3aed', '#dc2626'];
                        const colorHex = colors[idx % colors.length];
                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '1.15rem',
                              borderRadius: '14px',
                              border: '1px solid #e2e8f0',
                              backgroundColor: '#f8fafc',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <span style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                backgroundColor: colorHex,
                                color: '#ffffff',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                display: 'flex',
                                alignItems: 'center',
                                justifyCenter: 'center'
                              }}>
                                #{idx + 1}
                              </span>
                              <span style={{
                                backgroundColor: '#f0fdfa',
                                color: '#0f766e',
                                border: '1px solid #ccfbf1',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontSize: '0.74rem',
                                fontWeight: 800
                              }}>
                                {combo.likes} saves
                              </span>
                            </div>

                            <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a', marginBottom: '4px' }}>
                              {combo.label}
                            </div>
                            <div style={{ fontSize: '0.76rem', color: '#64748b', marginBottom: '10px' }}>
                              {combo.shape} shape in {combo.color} frame
                            </div>

                            <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{
                                width: `${combo.percentage}%`,
                                height: '100%',
                                backgroundColor: colorHex,
                                borderRadius: '999px'
                              }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.72rem', color: '#64748b' }}>
                              <span>Demand share</span>
                              <span style={{ fontWeight: 700, color: '#0f172a' }}>{combo.percentage}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* TABLE 1: MOST VIEWED FRAMES (Requirement 7) */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    padding: '1.5rem',
                    marginBottom: '2rem',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0284c7', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Eye size={20} />
                          <span>Most Viewed Frames</span>
                        </h3>
                        <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                          Individual catalogue items receiving the highest customer view counts and 3D Virtual Try-On impressions.
                        </p>
                      </div>
                      <span style={{
                        backgroundColor: '#eff6ff',
                        color: '#1d4ed8',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        Exact Database Views
                      </span>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #f1f5f9', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            <th style={{ padding: '0.75rem 1rem' }}>Frame Model</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Shape</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Colour</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Price</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Total Views</th>
                            <th style={{ padding: '0.75rem 1rem' }}>View Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(preferencesData?.most_viewed_frames || []).map((model, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #f8fafc', transition: 'background 0.15s' }}>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  {model.front_image && (
                                    <img
                                      src={model.front_image}
                                      alt={model.name}
                                      style={{ width: '44px', height: '30px', objectFit: 'contain', backgroundColor: '#f8fafc', borderRadius: '6px' }}
                                      onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                                    />
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{model.name}</div>
                                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{model.brand}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <span style={{
                                  backgroundColor: '#e0f2fe',
                                  color: '#0369a1',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700
                                }}>
                                  {model.shape}
                                </span>
                              </td>
                              <td style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 600 }}>
                                {model.color}
                              </td>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: '#0f172a' }}>
                                ₹{model.price}
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <span style={{
                                  backgroundColor: '#eff6ff',
                                  color: '#1d4ed8',
                                  border: '1px solid #bfdbfe',
                                  padding: '3px 10px',
                                  borderRadius: '999px',
                                  fontWeight: 800,
                                  fontSize: '0.82rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}>
                                  <Eye size={13} color="#2563eb" />
                                  {model.view_count || 0} views
                                </span>
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div style={{ width: '60px', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                                    <div style={{ width: `${model.view_share || 0}%`, height: '100%', backgroundColor: '#2563eb' }} />
                                  </div>
                                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#1d4ed8' }}>{model.view_share || 0}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* TABLE 2: MOST SELECTED FRAMES (Requirement 7) */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    padding: '1.5rem',
                    marginBottom: '2rem',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#059669', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Glasses size={20} />
                          <span>Most Selected Frames</span>
                        </h3>
                        <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                          Frames explicitly selected by customers in their EyeReach Collection and booked for doorstep home visit trials.
                        </p>
                      </div>
                      <span style={{
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        Exact Database Selections
                      </span>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #f1f5f9', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            <th style={{ padding: '0.75rem 1rem' }}>Frame Model</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Shape</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Colour</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Price</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Total Selections</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Selection Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(preferencesData?.most_selected_frames || []).map((model, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #f8fafc', transition: 'background 0.15s' }}>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  {model.front_image && (
                                    <img
                                      src={model.front_image}
                                      alt={model.name}
                                      style={{ width: '44px', height: '30px', objectFit: 'contain', backgroundColor: '#f8fafc', borderRadius: '6px' }}
                                      onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                                    />
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{model.name}</div>
                                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{model.brand}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <span style={{
                                  backgroundColor: '#dcfce7',
                                  color: '#15803d',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700
                                }}>
                                  {model.shape}
                                </span>
                              </td>
                              <td style={{ padding: '0.85rem 1rem', color: '#475569', fontWeight: 600 }}>
                                {model.color}
                              </td>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: '#0f172a' }}>
                                ₹{model.price}
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <span style={{
                                  backgroundColor: '#dcfce7',
                                  color: '#15803d',
                                  border: '1px solid #bbf7d0',
                                  padding: '3px 10px',
                                  borderRadius: '999px',
                                  fontWeight: 800,
                                  fontSize: '0.82rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}>
                                  <Glasses size={13} color="#059669" />
                                  {model.selection_count || 0} selections
                                </span>
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div style={{ width: '60px', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                                    <div style={{ width: `${model.selection_share || 0}%`, height: '100%', backgroundColor: '#059669' }} />
                                  </div>
                                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#059669' }}>{model.selection_share || 0}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Popular Frame Shapes & Colours Breakdown (Two Columns) */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                    gap: '1.5rem',
                    marginBottom: '2rem'
                  }}>
                    {/* Shapes Breakdown */}
                    <div style={{
                      background: '#ffffff',
                      borderRadius: '16px',
                      border: '1px solid #e2e8f0',
                      padding: '1.5rem',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                    }}>
                      <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                        Popular Frame Shapes
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {(preferencesData?.popular_shapes || []).map((s, idx) => (
                          <div key={idx}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 700, color: '#1e293b' }}>{s.shape}</span>
                              <span style={{ color: '#64748b' }}>
                                <strong>{s.likes} likes</strong> ({s.percentage}%)
                              </span>
                            </div>
                            <div style={{ width: '100%', height: '8px', backgroundColor: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{
                                width: `${s.percentage}%`,
                                height: '100%',
                                backgroundColor: idx === 0 ? '#0d9488' : '#0284c7',
                                borderRadius: '999px'
                              }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Colours Breakdown */}
                    <div style={{
                      background: '#ffffff',
                      borderRadius: '16px',
                      border: '1px solid #e2e8f0',
                      padding: '1.5rem',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                    }}>
                      <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                        Popular Frame Colours
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {(preferencesData?.popular_colors || []).map((c, idx) => (
                          <div key={idx}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 700, color: '#1e293b' }}>{c.color}</span>
                              <span style={{ color: '#64748b' }}>
                                <strong>{c.likes} likes</strong> ({c.percentage}%)
                              </span>
                            </div>
                            <div style={{ width: '100%', height: '8px', backgroundColor: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{
                                width: `${c.percentage}%`,
                                height: '100%',
                                backgroundColor: idx === 0 ? '#0f766e' : '#f59e0b',
                                borderRadius: '999px'
                              }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Smart Inventory Recommendation Callout */}
                  {preferencesData?.smart_recommendation && (
                    <div style={{
                      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                      color: '#ffffff',
                      borderRadius: '16px',
                      padding: '1.5rem 1.75rem',
                      marginBottom: '2rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '14px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '12px',
                          background: 'linear-gradient(135deg, #0d9488 0%, #0284c7 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <Sparkles size={22} color="#ffffff" />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#99f6e4', fontWeight: 800 }}>
                            AI Smart Restock Insight
                          </div>
                          <div style={{ fontSize: '0.96rem', fontWeight: 700, marginTop: '2px', maxWidth: '650px' }}>
                            {preferencesData.smart_recommendation}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveTab('inventory')}
                        style={{
                          backgroundColor: '#0d9488',
                          color: '#ffffff',
                          border: 'none',
                          padding: '0.65rem 1.25rem',
                          borderRadius: '10px',
                          fontWeight: 700,
                          fontSize: '0.84rem',
                          cursor: 'pointer'
                        }}
                      >
                        Check Inventory Levels →
                      </button>
                    </div>
                  )}

                  {/* Home Visit Appointments with Selected Frames */}
                  <div style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    padding: '1.5rem',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                          Home Visit Appointments • Requested Frame Trials
                        </h3>
                        <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                          Doorstep eye examination bookings with frames selected by customers for home trial.
                        </p>
                      </div>
                      <span style={{
                        backgroundColor: '#ccfbf1',
                        color: '#0f766e',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        {homeAppointments.length} Active Home Bookings
                      </span>
                    </div>

                    {homeAppointments.length === 0 ? (
                      <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.88rem' }}>
                        No home testing appointments scheduled yet.
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid #f1f5f9', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                              <th style={{ padding: '0.75rem 1rem' }}>Appointment ID</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Date & Time</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Selected Frames for Doorstep Trial</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Assigned Optometrist / Doctor</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Purpose</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {homeAppointments.map((appt) => (
                              <tr key={appt.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                                <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#0284c7' }}>
                                  #{appt.id}
                                </td>
                                <td style={{ padding: '0.85rem 1rem', color: '#334155' }}>
                                  <div>{appt.appointment_date}</div>
                                  <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{appt.appointment_time}</div>
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                  {(appt.selected_frames && appt.selected_frames.length > 0) ? (
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                      {appt.selected_frames.map((f, fIdx) => (
                                        <div key={fIdx} style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '6px',
                                          backgroundColor: '#f0fdfa',
                                          border: '1px solid #ccfbf1',
                                          padding: '2px 8px',
                                          borderRadius: '8px',
                                          fontSize: '0.76rem',
                                          fontWeight: 600,
                                          color: '#0f766e'
                                        }}>
                                          {f.front_image && (
                                            <img src={f.front_image} alt={f.name} style={{ width: '24px', height: '16px', objectFit: 'contain' }} />
                                          )}
                                          <span>{f.name} ({f.shape})</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                      Standard optician kit
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                  <select
                                    value={appt.doctor_id || ''}
                                    onChange={(e) => handleAssignDoctor(appt.id, e.target.value)}
                                    style={{
                                      padding: '0.4rem 0.6rem',
                                      borderRadius: '6px',
                                      border: '1px solid #cbd5e1',
                                      fontSize: '0.80rem',
                                      backgroundColor: appt.doctor_id ? '#f0fdf4' : '#ffffff',
                                      color: appt.doctor_id ? '#166534' : '#475569',
                                      fontWeight: 600,
                                      outline: 'none',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <option value="">Unassigned</option>
                                    {doctors.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.name} ({d.qualification || 'Optometrist'})
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td style={{ padding: '0.85rem 1rem', color: '#475569', fontSize: '0.82rem' }}>
                                  {appt.purpose}
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                  <span style={{
                                    backgroundColor: appt.status === 'Confirmed' ? '#dcfce7' : appt.status === 'Rejected' ? '#fee2e2' : '#fef9c3',
                                    color: appt.status === 'Confirmed' ? '#15803d' : appt.status === 'Rejected' ? '#b91c1c' : '#854d0e',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    fontWeight: 700,
                                    fontSize: '0.75rem'
                                  }}>
                                    {appt.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 2: MODULE 3 - FRAME INVENTORY MANAGEMENT (CRUD) */}
          {activeTab === 'inventory' && (
            <div>
              {/* Filter & Search Bar */}
              <div style={{
                background: '#ffffff',
                padding: '1rem',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '1.25rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '240px' }}>
                  <Search size={18} color="#64748b" />
                  <input
                    type="text"
                    placeholder="Search by brand, name, product ID or color..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchProducts(); }}
                    style={{
                      border: 'none',
                      outline: 'none',
                      fontSize: '0.90rem',
                      width: '100%',
                      background: 'transparent'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={shapeFilter}
                    onChange={(e) => setShapeFilter(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                  >
                    <option value="All">All Shapes</option>
                    <option value="Round">Round</option>
                    <option value="Rectangle">Rectangle</option>
                    <option value="Square">Square</option>
                    <option value="Aviator">Aviator</option>
                    <option value="Cat-Eye">Cat-Eye</option>
                    <option value="Geometric">Geometric</option>
                    <option value="Oval">Oval</option>
                  </select>

                  <select
                    value={genderFilter}
                    onChange={(e) => setGenderFilter(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                  >
                    <option value="All">All Genders</option>
                    <option value="Men">Men</option>
                    <option value="Women">Women</option>
                    <option value="Unisex">Unisex</option>
                  </select>

                  <button
                    onClick={() => setActiveTab('add_frame')}
                    style={{
                      padding: '0.5rem 1rem',
                      background: '#0d7665',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <PlusCircle size={16} />
                    <span>Add Frame</span>
                  </button>
                </div>
              </div>

              {/* Products Table */}
              <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                      <th style={{ padding: '0.85rem 1rem' }}>Product</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Code</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Shape</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Material</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Size (A-DBL-T)</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Price</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Stock</th>
                      <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr>
                        <td colSpan="8" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          No frames found in your inventory. Add your first product or upload in bulk!
                        </td>
                      </tr>
                    ) : (
                      products.map((p) => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <img
                              src={p.front_image}
                              alt={p.name}
                              style={{ width: '48px', height: '32px', objectFit: 'contain', background: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}
                              onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                            />
                            <div>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.brand} • {p.color}</div>
                            </div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#0284c7' }}>{p.product_id}</td>
                          <td style={{ padding: '0.85rem 1rem' }}>{p.shape}</td>
                          <td style={{ padding: '0.85rem 1rem' }}>{p.material}</td>
                          <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>
                            {p.size || `${p.lens_width_mm || 50}-${p.bridge_width_mm || 18}-${p.temple_length_mm || 140}`}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: '#0f172a' }}>₹{p.price}</td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              background: p.stock_quantity > 0 ? '#dcfce7' : '#fee2e2',
                              color: p.stock_quantity > 0 ? '#15803d' : '#b91c1c'
                            }}>
                              {p.stock_quantity > 0 ? `${p.stock_quantity} in stock` : 'Out of stock'}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => handleOpenEditModal(p)}
                              style={{
                                background: '#e0f2fe',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '0.4rem 0.65rem',
                                color: '#0369a1',
                                cursor: 'pointer',
                                marginRight: '6px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.78rem',
                                fontWeight: 700
                              }}
                              title="Edit Frame"
                            >
                              <Edit size={14} />
                              <span>Edit</span>
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(p.id, p.name)}
                              style={{
                                background: '#fee2e2',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '0.4rem 0.65rem',
                                color: '#b91c1c',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.78rem',
                                fontWeight: 700
                              }}
                              title="Delete Frame"
                            >
                              <Trash2 size={14} />
                              <span>Delete</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: MODULE 4A & 5 - ADD NEW FRAME + AI DESCRIPTION */}
          {activeTab === 'add_frame' && (
            <div style={{ maxWidth: '820px', background: '#ffffff', padding: '2rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Add New Spectacle Frame to Store Inventory
              </h2>
              <p style={{ margin: '0 0 1.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
                Fill in the product details and physical dimensions. Use the AI Assistant to generate a compelling product description automatically.
              </p>

              {singleSubmitMsg && (
                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  marginBottom: '1.25rem',
                  fontSize: '0.88rem',
                  background: singleSubmitMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                  color: singleSubmitMsg.type === 'success' ? '#15803d' : '#b91c1c'
                }}>
                  {singleSubmitMsg.text}
                </div>
              )}

              <form onSubmit={handleSingleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Product ID *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. FR009"
                      value={singleForm.product_id}
                      onChange={(e) => setSingleForm({ ...singleForm, product_id: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Brand Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ray-Ban, Vogue, Fastrack"
                      value={singleForm.brand}
                      onChange={(e) => setSingleForm({ ...singleForm, brand: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Frame Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Classic Wayfarer Noir"
                      value={singleForm.name}
                      onChange={(e) => setSingleForm({ ...singleForm, name: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Shape *</label>
                    <select
                      value={singleForm.shape}
                      onChange={(e) => setSingleForm({ ...singleForm, shape: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="Round">Round</option>
                      <option value="Rectangle">Rectangle</option>
                      <option value="Square">Square</option>
                      <option value="Aviator">Aviator</option>
                      <option value="Cat-Eye">Cat-Eye</option>
                      <option value="Geometric">Geometric</option>
                      <option value="Oval">Oval</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Material *</label>
                    <select
                      value={singleForm.material}
                      onChange={(e) => setSingleForm({ ...singleForm, material: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="Acetate">Acetate</option>
                      <option value="Titanium">Titanium</option>
                      <option value="Metal">Metal</option>
                      <option value="TR90">TR90 Polymer</option>
                      <option value="Wood">Wood</option>
                      <option value="Mixed">Mixed Metal/Acetate</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Colour *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Tortoise, Gold, Matte Black"
                      value={singleForm.color}
                      onChange={(e) => setSingleForm({ ...singleForm, color: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Frame Type *</label>
                    <select
                      value={singleForm.frame_type}
                      onChange={(e) => setSingleForm({ ...singleForm, frame_type: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="Full Rim">Full Rim</option>
                      <option value="Semi-Rimless">Semi-Rimless</option>
                      <option value="Rimless">Rimless</option>
                    </select>
                  </div>
                </div>

                {/* Dimensions (Boxing system mm) */}
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
                    Physical Dimensions (Boxing System Specifications in mm)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Lens Width (A)</label>
                      <input
                        type="number"
                        value={singleForm.lens_width_mm}
                        onChange={(e) => setSingleForm({ ...singleForm, lens_width_mm: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Bridge (DBL)</label>
                      <input
                        type="number"
                        value={singleForm.bridge_width_mm}
                        onChange={(e) => setSingleForm({ ...singleForm, bridge_width_mm: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Temple Length</label>
                      <input
                        type="number"
                        value={singleForm.temple_length_mm}
                        onChange={(e) => setSingleForm({ ...singleForm, temple_length_mm: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Price (₹) *</label>
                      <input
                        type="number"
                        required
                        value={singleForm.price}
                        onChange={(e) => setSingleForm({ ...singleForm, price: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>Stock Qty</label>
                      <input
                        type="number"
                        value={singleForm.stock_quantity}
                        onChange={(e) => setSingleForm({ ...singleForm, stock_quantity: parseInt(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                  </div>
                </div>

                {/* MODULE 5: AI Description Generation Section */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>Product Description</label>
                    <button
                      type="button"
                      onClick={handleGenerateDescription}
                      disabled={aiDescLoading}
                      style={{
                        background: '#e0f2fe',
                        border: '1px solid #bae6fd',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        color: '#0369a1',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Sparkles size={14} />
                      <span>{aiDescLoading ? 'AI Generating...' : 'AI Generate Description'}</span>
                    </button>
                  </div>
                  <textarea
                    rows="3"
                    placeholder="Enter description or click 'AI Generate Description' above..."
                    value={singleForm.description}
                    onChange={(e) => setSingleForm({ ...singleForm, description: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  ></textarea>
                </div>

                {/* Real Spectacle Photo Selection */}
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a' }}>Real Optical Spectacle Photos</div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Select from high-definition transparent real spectacle photos or paste an image URL</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setGalleryTarget('add'); setShowGalleryPicker(true); }}
                      style={{
                        padding: '0.45rem 0.9rem',
                        backgroundColor: '#0284c7',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Glasses size={14} />
                      <span>Choose from Real Frames Gallery</span>
                    </button>
                  </div>
                  {singleForm.front_image && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <img
                        src={singleForm.front_image}
                        alt="Selected frame preview"
                        style={{ width: '80px', height: '48px', objectFit: 'contain', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '4px' }}
                        onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                      />
                      <span style={{ fontSize: '0.78rem', color: '#475569', wordBreak: 'break-all' }}>
                        Selected: <code>{singleForm.front_image}</code>
                      </span>
                    </div>
                  )}
                </div>

                {/* Imagery Inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Front Image URL / Path *</label>
                    <input
                      type="text"
                      required
                      value={singleForm.front_image}
                      onChange={(e) => setSingleForm({ ...singleForm, front_image: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Side Image URL</label>
                    <input
                      type="text"
                      value={singleForm.side_image}
                      onChange={(e) => setSingleForm({ ...singleForm, side_image: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Angled 45° Image URL</label>
                    <input
                      type="text"
                      value={singleForm.angled_image}
                      onChange={(e) => setSingleForm({ ...singleForm, angled_image: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  style={{
                    padding: '0.85rem 1.75rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    cursor: 'pointer'
                  }}
                >
                  Save Frame to Shop Inventory
                </button>
              </form>
            </div>
          )}

          {/* TAB 4: MODULE 4B - BULK UPLOAD (EXCEL/CSV) */}
          {activeTab === 'bulk_upload' && (
            <div style={{ maxWidth: '820px', background: '#ffffff', padding: '2rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Bulk Frame Inventory Upload (Excel & CSV)
              </h2>
              <p style={{ margin: '0 0 1.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
                Upload dozens or hundreds of spectacle frames simultaneously. Download the verified template below to ensure proper column alignment.
              </p>

              {/* Download Template Buttons */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
                <a
                  href="/api/shop/template?format=csv"
                  download
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '0.65rem 1.25rem',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    color: '#0f172a',
                    textDecoration: 'none',
                    fontWeight: 700,
                    fontSize: '0.85rem'
                  }}
                >
                  <Download size={16} color="#0d7665" />
                  <span>Download CSV Template</span>
                </a>

                <a
                  href="/api/shop/template?format=xlsx"
                  download
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '0.65rem 1.25rem',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    color: '#0f172a',
                    textDecoration: 'none',
                    fontWeight: 700,
                    fontSize: '0.85rem'
                  }}
                >
                  <FileSpreadsheet size={16} color="#0284c7" />
                  <span>Download Excel (.xlsx) Template</span>
                </a>
              </div>

              {/* Upload Dropzone */}
              <form onSubmit={handleBulkUpload}>
                <div style={{
                  border: '2px dashed #cbd5e1',
                  borderRadius: '12px',
                  padding: '2.5rem',
                  textAlign: 'center',
                  background: '#f8fafc',
                  marginBottom: '1.5rem'
                }}>
                  <UploadCloud size={40} color="#0d7665" style={{ marginBottom: '0.75rem' }} />
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                    Choose CSV or Excel (.xlsx) File
                  </div>
                  <div style={{ fontSize: '0.80rem', color: '#64748b', marginBottom: '1rem' }}>
                    Automatic validation, duplicate Product ID checking, and instant inventory insertion
                  </div>
                  <input
                    type="file"
                    accept=".csv, .xlsx"
                    onChange={(e) => setBulkFile(e.target.files[0])}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={!bulkFile || bulkUploading}
                  style={{
                    padding: '0.85rem 1.75rem',
                    background: bulkFile ? '#0d7665' : '#94a3b8',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    cursor: bulkFile ? 'pointer' : 'not-allowed'
                  }}
                >
                  {bulkUploading ? 'Validating and Importing...' : 'Upload & Process Inventory'}
                </button>
              </form>

              {/* Validation / Success Report */}
              {bulkReport && (
                <div style={{
                  marginTop: '1.75rem',
                  padding: '1.25rem',
                  borderRadius: '10px',
                  background: bulkReport.imported_count > 0 ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${bulkReport.imported_count > 0 ? '#86efac' : '#fecaca'}`
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                    {bulkReport.imported_count > 0 ? (
                      <CheckCircle size={20} color="#16a34a" />
                    ) : (
                      <AlertTriangle size={20} color="#dc2626" />
                    )}
                    <strong style={{ color: bulkReport.imported_count > 0 ? '#15803d' : '#991b1b' }}>
                      {bulkReport.message}
                    </strong>
                  </div>

                  {bulkReport.errors && bulkReport.errors.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#991b1b', marginBottom: '4px' }}>
                        Row Validation Errors ({bulkReport.errors.length}):
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#b91c1c', fontSize: '0.78rem' }}>
                        {bulkReport.errors.map((err, i) => (
                          <li key={i}>Row {err.row}: {err.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: MODULE 6 - AI TEXT-TO-IMAGE FRAME GENERATOR */}
          {activeTab === 'ai_generator' && (
            <div style={{ maxWidth: '860px', background: '#ffffff', padding: '2rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                <Wand2 size={24} color="#0d7665" />
                <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                  AI Text-to-Image Optical Frame Generator
                </h2>
              </div>
              <p style={{ margin: '0 0 1.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
                Synthesize custom optical spectacle frames from natural language descriptions. Approve the design to create an instant catalog product.
              </p>

              <form onSubmit={handleGenerateFrame}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                    Natural Language Prompt *
                  </label>
                  <textarea
                    rows="3"
                    required
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. Generate a rectangular spectacle frame, red colour, full rim, acetate material, modern design."
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.92rem', boxSizing: 'border-box' }}
                  ></textarea>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Shape</label>
                    <select value={aiShape} onChange={(e) => setAiShape(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                      <option value="Rectangle">Rectangle</option>
                      <option value="Round">Round</option>
                      <option value="Square">Square</option>
                      <option value="Aviator">Aviator</option>
                      <option value="Cat-Eye">Cat-Eye</option>
                      <option value="Geometric">Geometric</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Colour</label>
                    <select value={aiColor} onChange={(e) => setAiColor(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                      <option value="Black">Black</option>
                      <option value="Gold">Gold</option>
                      <option value="Silver">Silver</option>
                      <option value="Tortoise">Tortoise</option>
                      <option value="Blue">Blue</option>
                      <option value="Red">Red</option>
                      <option value="Clear">Clear Crystal</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Material</label>
                    <select value={aiMaterial} onChange={(e) => setAiMaterial(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                      <option value="Acetate">Acetate</option>
                      <option value="Titanium">Titanium</option>
                      <option value="Metal">Alloy Wire</option>
                      <option value="TR90">TR90 Polymer</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Design Style</label>
                    <select value={aiStyle} onChange={(e) => setAiStyle(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                      <option value="Modern">Modern Executive</option>
                      <option value="Vintage">Vintage Heritage</option>
                      <option value="Minimalist">Ultra Minimalist</option>
                      <option value="Avant-Garde">Avant-Garde</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={aiGenerating}
                  style={{
                    padding: '0.85rem 1.75rem',
                    background: 'linear-gradient(135deg, #0d7665, #0f766e)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Sparkles size={18} />
                  <span>{aiGenerating ? 'Synthesizing Eyewear Model...' : 'Generate Spectacle Frame'}</span>
                </button>
              </form>

              {/* Generated Image Result Card */}
              {generatedResult && (
                <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px', background: '#dcfce7', color: '#15803d' }}>
                        {generatedResult.engine}
                      </span>
                      <h4 style={{ margin: '0.35rem 0 0 0', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                        AI Generated Model: {generatedResult.specs?.color} {generatedResult.specs?.shape}
                      </h4>
                    </div>

                    <button
                      onClick={handleGenerateFrame}
                      style={{
                        padding: '0.45rem 0.85rem',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '0.80rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <RefreshCw size={14} />
                      Regenerate
                    </button>
                  </div>

                  <div style={{
                    background: '#ffffff',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    padding: '2rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '220px',
                    marginBottom: '1rem'
                  }}>
                    <img
                      src={generatedResult.image_url}
                      alt="AI Generated Spectacle Frame"
                      style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }}
                    />
                  </div>

                  {generatedResult.configuration_notice && (
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '1rem' }}>
                      ℹ️ {generatedResult.configuration_notice}
                    </div>
                  )}

                  {approveMsg && (
                    <div style={{
                      padding: '0.65rem 1rem',
                      borderRadius: '6px',
                      marginBottom: '1rem',
                      fontSize: '0.85rem',
                      background: approveMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                      color: approveMsg.type === 'success' ? '#15803d' : '#b91c1c'
                    }}>
                      {approveMsg.text}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={handleApproveSave}
                      style={{
                        padding: '0.75rem 1.5rem',
                        background: '#16a34a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontWeight: 800,
                        fontSize: '0.90rem',
                        cursor: 'pointer'
                      }}
                    >
                      ✓ Approve & Save to Store Inventory
                    </button>

                    <button
                      onClick={() => setGeneratedResult(null)}
                      style={{
                        padding: '0.75rem 1.25rem',
                        background: '#ffffff',
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '0.90rem',
                        cursor: 'pointer'
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: ORDERS */}
          {activeTab === 'orders' && (
            <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Store Orders & Customer Try-On Requests
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Order #</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Customer</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Phone</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Frame</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Amount</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Status</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Update</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No orders placed yet.</td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0284c7' }}>{o.order_number}</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>{o.customer_name}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{o.customer_phone}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{o.product_name} ({o.product_code})</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 800 }}>₹{o.total_amount}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            background: o.status === 'Completed' ? '#dcfce7' : o.status === 'Confirmed' ? '#e0f2fe' : '#fef3c7',
                            color: o.status === 'Completed' ? '#15803d' : o.status === 'Confirmed' ? '#0369a1' : '#b45309'
                          }}>
                            {o.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <select
                            value={o.status}
                            onChange={(e) => handleUpdateOrderStatus(o.id, e.target.value)}
                            style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.78rem' }}
                          >
                            <option value="Confirmed">Confirmed</option>
                            <option value="Ready for Pickup">Ready for Pickup</option>
                            <option value="Completed">Completed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 7: CUSTOMERS */}
          {activeTab === 'customers' && (
            <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Store Customer Directory & Facial Profiles
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Customer</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Phone</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Email</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Detected Face Shape</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Calibrated IPD</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Registered Date</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No customer profiles recorded yet.</td>
                    </tr>
                  ) : (
                    customers.map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>{c.name}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{c.mobile}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{c.email}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700, background: '#f1f5f9', color: '#0f172a' }}>
                            {c.face_shape}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>{c.ipd_mm ? `${c.ipd_mm} mm` : 'Pending scan'}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{c.created_at}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB: LINKED DOCTORS & OPTOMETRISTS (Requirement 3) */}
          {activeTab === 'doctors' && (
            <div style={{ background: '#ffffff', padding: '1.75rem', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Stethoscope size={22} color="#0d7665" />
                    Linked Optometrists & Doctors
                  </h2>
                  <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                    Manage certified eye-care professionals linked to your optical store for doorstep eye consultations and frame review.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddDoctorModal(true)}
                  style={{
                    padding: '0.65rem 1.25rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <PlusCircle size={16} />
                  <span>Add Optometrist / Doctor</span>
                </button>
              </div>

              {loadingDoctors ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>Loading linked optometrists...</div>
              ) : doctors.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '10px' }}>
                  No doctors or optometrists linked yet. Click "Add Optometrist / Doctor" above to link your first practitioner.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                        <th style={{ padding: '0.85rem 1rem', textAlign: 'left' }}>Doctor Name</th>
                        <th style={{ padding: '0.85rem 1rem', textAlign: 'left' }}>Specialization</th>
                        <th style={{ padding: '0.85rem 1rem', textAlign: 'left' }}>Registration No.</th>
                        <th style={{ padding: '0.85rem 1rem', textAlign: 'left' }}>Contact</th>
                        <th style={{ padding: '0.85rem 1rem', textAlign: 'left' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doctors.map((d) => (
                        <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{d.name}</div>
                            <div style={{ fontSize: '0.75rem', color: '#0d7665', fontWeight: 600 }}>{d.qualification || 'Optometrist'}</div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', color: '#334155', fontWeight: 500 }}>
                            {d.specialization}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.80rem', backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', color: '#0f172a' }}>
                              {d.registration_number || 'REG-ACTIVE'}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <div style={{ color: '#0f172a', fontWeight: 600 }}>{d.email}</div>
                            <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{d.mobile}</div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <span style={{
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              backgroundColor: '#dcfce7',
                              color: '#15803d'
                            }}>
                              Active Practitioner
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 8: STORE PERFORMANCE & RETAIL ANALYTICS (Requirement 2 - No TAM/SAM/SOM) */}
          {activeTab === 'analytics' && (
            <div style={{ maxWidth: '860px', background: '#ffffff', padding: '2rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                  Optical Store Performance & Retail Analytics
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                  Comprehensive overview of catalog performance, customer consultations, and home dispensing metrics.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '10px', padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 700 }}>Total Store Inventory</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#14532d', margin: '4px 0' }}>{stats?.total_products || 0} Models</div>
                  <div style={{ fontSize: '0.72rem', color: '#15803d' }}>{stats?.total_frames || 0} physical frame units in stock</div>
                </div>

                <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '10px', padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#1e40af', fontWeight: 700 }}>Total Sales Revenue</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#1e3a8a', margin: '4px 0' }}>₹{(stats?.sales_overview?.total_revenue || 0).toLocaleString()}</div>
                  <div style={{ fontSize: '0.72rem', color: '#1d4ed8' }}>Fulfilled customer dispensing orders</div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 700 }}>Active Home Appointments</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', margin: '4px 0' }}>{homeAppointments.length}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Doorstep eye examination requests</div>
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569', lineHeight: 1.6 }}>
                <strong>Store Operational Insights:</strong>
                <br />
                • <strong>Biometric Try-On Accuracy:</strong> EyeReach calibrated interpupillary distance (IPD) verification provides accurate frame fit prior to doorstep delivery, minimizing product returns.
                <br />
                • <strong>Doorstep Home Dispensing:</strong> Enabling customers to select up to 10 optical frames for home trial significantly improves prescription eyewear adoption and customer satisfaction.
              </div>
            </div>
          )}

          {/* TAB 9: SHOP PROFILE */}
          {activeTab === 'profile' && (
            <div style={{ maxWidth: '640px', background: '#ffffff', padding: '2rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Optical Shop Profile & Address
              </h2>
              <p style={{ margin: '0 0 1.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
                This information appears on customer product cards and store reservation receipts.
              </p>

              {profileMsg && (
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  background: profileMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                  color: profileMsg.type === 'success' ? '#15803d' : '#b91c1c'
                }}>
                  {profileMsg.text}
                </div>
              )}

              <form onSubmit={handleUpdateProfile}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Optical Shop Name</label>
                  <input
                    type="text"
                    required
                    value={profileForm.shop_name}
                    onChange={(e) => setProfileForm({ ...profileForm, shop_name: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Owner Name</label>
                  <input
                    type="text"
                    required
                    value={profileForm.owner_name}
                    onChange={(e) => setProfileForm({ ...profileForm, owner_name: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Mobile Contact</label>
                  <input
                    type="tel"
                    required
                    value={profileForm.mobile_number}
                    onChange={(e) => setProfileForm({ ...profileForm, mobile_number: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Store Address</label>
                  <textarea
                    rows="3"
                    required
                    value={profileForm.shop_address}
                    onChange={(e) => setProfileForm({ ...profileForm, shop_address: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  ></textarea>
                </div>

                <button
                  type="submit"
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.90rem',
                    cursor: 'pointer'
                  }}
                >
                  Save Store Profile
                </button>
              </form>
            </div>
          )}

          {/* TAB 10: OWNER SETTINGS & PASSWORD (Requirement 8) */}
          {activeTab === 'settings' && (
            <div style={{ maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Store & Owner Profile Card */}
              <div style={{ background: '#ffffff', padding: '1.75rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                  Owner Profile Settings
                </h2>
                <p style={{ margin: '0 0 1.25rem 0', color: '#64748b', fontSize: '0.84rem' }}>
                  Update your personal profile, optical dispensary details, and contact information.
                </p>

                {profileMsg && (
                  <div style={{
                    padding: '0.75rem',
                    borderRadius: '6px',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    background: profileMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                    color: profileMsg.type === 'success' ? '#15803d' : '#b91c1c'
                  }}>
                    {profileMsg.text}
                  </div>
                )}

                <form onSubmit={handleUpdateProfile}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Optical Shop Name</label>
                      <input
                        type="text"
                        required
                        value={profileForm.shop_name}
                        onChange={(e) => setProfileForm({ ...profileForm, shop_name: e.target.value })}
                        style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Owner Full Name</label>
                      <input
                        type="text"
                        required
                        value={profileForm.owner_name}
                        onChange={(e) => setProfileForm({ ...profileForm, owner_name: e.target.value })}
                        style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Mobile Contact</label>
                    <input
                      type="tel"
                      required
                      value={profileForm.mobile_number}
                      onChange={(e) => setProfileForm({ ...profileForm, mobile_number: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Store Address</label>
                    <textarea
                      rows="2"
                      required
                      value={profileForm.shop_address}
                      onChange={(e) => setProfileForm({ ...profileForm, shop_address: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    ></textarea>
                  </div>

                  <button
                    type="submit"
                    style={{
                      padding: '0.65rem 1.25rem',
                      background: '#0d7665',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      cursor: 'pointer'
                    }}
                  >
                    Save Profile Changes
                  </button>
                </form>
              </div>

              {/* Change Password Card (Requirement 8) */}
              <div style={{ background: '#ffffff', padding: '1.75rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  Change Owner Account Password
                </h3>
                <p style={{ margin: '0 0 1.25rem 0', color: '#64748b', fontSize: '0.84rem' }}>
                  Ensure your optical store owner portal remains secure by setting a strong password.
                </p>

                {passwordMsg && (
                  <div style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    backgroundColor: passwordMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                    color: passwordMsg.type === 'success' ? '#15803d' : '#b91c1c'
                  }}>
                    {passwordMsg.text}
                  </div>
                )}

                <form onSubmit={handleChangePassword}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                      Current Password *
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="Enter current password"
                      value={passwordForm.current_password}
                      onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                        New Password *
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="Enter new password"
                        value={passwordForm.new_password}
                        onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                        style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                        Confirm New Password *
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="Confirm new password"
                        value={passwordForm.confirm_password}
                        onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                        style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={passwordLoading}
                    style={{
                      padding: '0.65rem 1.5rem',
                      background: '#0d7665',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      cursor: passwordLoading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {passwordLoading ? 'Updating Password...' : 'Update Password'}
                  </button>
                </form>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* EDIT PRODUCT MODAL (Requirement 1) */}
      {editModalOpen && editingProduct && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '640px',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            border: '1px solid #e2e8f0',
            padding: '1.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit size={20} color="#0d7665" />
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  Edit Frame #{editingProduct.product_id}
                </h3>
              </div>
              <button
                onClick={() => setEditModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            {editSubmitMsg && (
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                backgroundColor: editSubmitMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                color: editSubmitMsg.type === 'success' ? '#15803d' : '#b91c1c'
              }}>
                {editSubmitMsg.text}
              </div>
            )}

            <form onSubmit={handleEditProductSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Brand</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.brand}
                    onChange={(e) => setEditingProduct({ ...editingProduct, brand: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Frame Name</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.name}
                    onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Shape</label>
                  <select
                    value={editingProduct.shape}
                    onChange={(e) => setEditingProduct({ ...editingProduct, shape: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  >
                    <option value="Round">Round</option>
                    <option value="Rectangle">Rectangle</option>
                    <option value="Square">Square</option>
                    <option value="Aviator">Aviator</option>
                    <option value="Cat-Eye">Cat-Eye</option>
                    <option value="Geometric">Geometric</option>
                    <option value="Oval">Oval</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Material</label>
                  <select
                    value={editingProduct.material}
                    onChange={(e) => setEditingProduct({ ...editingProduct, material: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  >
                    <option value="Acetate">Acetate</option>
                    <option value="Titanium">Titanium</option>
                    <option value="Metal">Metal</option>
                    <option value="TR90">TR90 Polymer</option>
                    <option value="Wood">Wood</option>
                    <option value="Mixed">Mixed</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Colour</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.color}
                    onChange={(e) => setEditingProduct({ ...editingProduct, color: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Price (₹)</label>
                  <input
                    type="number"
                    required
                    value={editingProduct.price}
                    onChange={(e) => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Stock Qty</label>
                  <input
                    type="number"
                    required
                    value={editingProduct.stock_quantity}
                    onChange={(e) => setEditingProduct({ ...editingProduct, stock_quantity: parseInt(e.target.value) || 0 })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>Frame Type</label>
                  <select
                    value={editingProduct.frame_type || 'Full Rim'}
                    onChange={(e) => setEditingProduct({ ...editingProduct, frame_type: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  >
                    <option value="Full Rim">Full Rim</option>
                    <option value="Semi-Rimless">Semi-Rimless</option>
                    <option value="Rimless">Rimless</option>
                  </select>
                </div>
              </div>

              {/* Photo & Gallery selection */}
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <label style={{ fontSize: '0.80rem', fontWeight: 700, color: '#0f172a' }}>Real Spectacle Photo</label>
                  <button
                    type="button"
                    onClick={() => { setGalleryTarget('edit'); setShowGalleryPicker(true); }}
                    style={{
                      background: '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Change from Gallery
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <img
                    src={editingProduct.front_image}
                    alt={editingProduct.name}
                    style={{ width: '64px', height: '40px', objectFit: 'contain', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '2px' }}
                    onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                  />
                  <input
                    type="text"
                    value={editingProduct.front_image}
                    onChange={(e) => setEditingProduct({ ...editingProduct, front_image: e.target.value })}
                    style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  style={{
                    padding: '0.65rem 1.25rem',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: '#475569',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.65rem 1.5rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REAL FRAMES GALLERY MODAL (Requirement 1 - Real optical spectacle photos) */}
      {showGalleryPicker && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '820px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.25)',
            border: '1px solid #e2e8f0',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#f8fafc'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Glasses size={20} color="#0d7665" />
                  Real Optical Spectacle Photos Gallery
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.80rem', color: '#64748b' }}>
                  Click on any real optical spectacle frame to set it for your product.
                </p>
              </div>
              <button
                onClick={() => setShowGalleryPicker(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{
              padding: '1.5rem',
              overflowY: 'auto',
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: '12px',
              backgroundColor: '#ffffff'
            }}>
              {realGallery.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                  Loading real spectacle gallery...
                </div>
              ) : (
                realGallery.map((imgUrl, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      if (galleryTarget === 'add') {
                        setSingleForm((prev) => ({
                          ...prev,
                          front_image: imgUrl,
                          side_image: imgUrl,
                          angled_image: imgUrl
                        }));
                      } else if (galleryTarget === 'edit') {
                        setEditingProduct((prev) => ({
                          ...prev,
                          front_image: imgUrl
                        }));
                      }
                      setShowGalleryPicker(false);
                    }}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '8px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      backgroundColor: '#f8fafc',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#0d7665';
                      e.currentTarget.style.boxShadow = '0 4px 6px rgba(13, 118, 101, 0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <img
                      src={imgUrl}
                      alt={`Optical frame ${i}`}
                      style={{ width: '100%', height: '60px', objectFit: 'contain' }}
                      onError={(e) => { e.target.src = '/frames/kaggle/0_mt6960_0.png'; }}
                    />
                    <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {imgUrl.split('/').pop()}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', textAlign: 'right' }}>
              <button
                onClick={() => setShowGalleryPicker(false)}
                style={{
                  padding: '0.5rem 1.25rem',
                  background: '#64748b',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Close Gallery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD DOCTOR MODAL (Requirement 3) */}
      {showAddDoctorModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '560px',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            border: '1px solid #e2e8f0',
            padding: '1.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Stethoscope size={22} color="#0d7665" />
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                  Link New Optometrist / Doctor
                </h3>
              </div>
              <button
                onClick={() => setShowAddDoctorModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            {doctorSubmitMsg && (
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                backgroundColor: doctorSubmitMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
                color: doctorSubmitMsg.type === 'success' ? '#15803d' : '#b91c1c'
              }}>
                {doctorSubmitMsg.text}
              </div>
            )}

            <form onSubmit={handleAddDoctorSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                  Doctor / Practitioner Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Rajesh Sharma"
                  value={newDoctorForm.name}
                  onChange={(e) => setNewDoctorForm({ ...newDoctorForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                    Email (Login ID) *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="doctor@eyereach.com"
                    value={newDoctorForm.email}
                    onChange={(e) => setNewDoctorForm({ ...newDoctorForm, email: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={newDoctorForm.mobile}
                    onChange={(e) => setNewDoctorForm({ ...newDoctorForm, mobile: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                    Qualification *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. B.Optom, M.Optom, FAAO"
                    value={newDoctorForm.qualification}
                    onChange={(e) => setNewDoctorForm({ ...newDoctorForm, qualification: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                    Registration No.
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. KA-OPT-2022-9102"
                    value={newDoctorForm.registration_number}
                    onChange={(e) => setNewDoctorForm({ ...newDoctorForm, registration_number: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                  Specialization
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Clinical Optometry & Ophthalmic Dispenser"
                  value={newDoctorForm.specialization}
                  onChange={(e) => setNewDoctorForm({ ...newDoctorForm, specialization: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                  Portal Password *
                </label>
                <input
                  type="password"
                  required
                  placeholder="Set login password for doctor portal"
                  value={newDoctorForm.password}
                  onChange={(e) => setNewDoctorForm({ ...newDoctorForm, password: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddDoctorModal(false)}
                  style={{
                    padding: '0.65rem 1.25rem',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    color: '#475569',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.65rem 1.5rem',
                    background: '#0d7665',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  Link Practitioner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
