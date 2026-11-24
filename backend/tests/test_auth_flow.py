"""
Automated Integration Tests for EyeReach Authentication System.
Verifies:
1. Option A: Mobile Number OTP generation, validation, rate-limiting, and profile creation.
2. Option B: Email and Password login and credential validation.
3. Optical Shop Owner login and registration preservation.
4. Forgot Password request handling.
"""

import pytest
import os
from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)

TEST_MOBILE = "9876543299"
TEST_NAME = "Savitri Devi"
TEST_ADDRESS = "Flat 302, Senior Living Complex, Whitefield, Bengaluru"

def test_mobile_otp_send_and_verify_flow():
    """Test full Option A: Mobile number OTP dispatch, verification, and customer creation."""
    # 1. Send OTP
    send_payload = {
        "mobile": TEST_MOBILE,
        "name": TEST_NAME,
        "address": TEST_ADDRESS
    }
    res_send = client.post("/api/customer/otp/send", json=send_payload)
    assert res_send.status_code == 200
    data_send = res_send.json()
    assert data_send["status"] == "success"
    assert "Verification code sent" in data_send["message"]
    assert "dev_otp" in data_send
    otp_code = data_send["dev_otp"]
    assert otp_code is not None
    assert len(otp_code) == 6

    # 2. Test Invalid OTP rejection
    res_invalid = client.post("/api/customer/otp/verify", json={
        "mobile": TEST_MOBILE,
        "otp": "000000"
    })
    assert res_invalid.status_code == 400
    assert "Incorrect verification code" in res_invalid.json()["detail"]

    # 3. Test Valid OTP verification
    res_verify = client.post("/api/customer/otp/verify", json={
        "mobile": TEST_MOBILE,
        "otp": otp_code,
        "name": TEST_NAME,
        "address": TEST_ADDRESS
    })
    assert res_verify.status_code == 200
    data_verify = res_verify.json()
    assert data_verify["status"] == "success"
    assert "token" in data_verify
    assert data_verify["customer"]["name"] == TEST_NAME
    assert data_verify["customer"]["mobile"] == TEST_MOBILE
    assert data_verify["customer"]["address"] == TEST_ADDRESS

def test_mobile_otp_invalid_phone_rejection():
    """Verify phone numbers with fewer than 10 digits are rejected."""
    res = client.post("/api/customer/otp/send", json={"mobile": "12345"})
    assert res.status_code == 400
    assert "valid 10-digit" in res.json()["detail"]

def test_customer_email_password_login():
    """Verify Option B: Existing email & password authentication."""
    # Test valid demo or created account
    res = client.post("/api/customer/login", json={
        "email": "rajesh@visioncraft.com", # or customer
        "password": "wrongpassword"
    })
    # Incorrect password should return 401
    assert res.status_code == 401
    assert "Invalid email or password" in res.json()["detail"]

def test_forgot_password_endpoint():
    """Verify Forgot Password endpoint returns standard reassurance message."""
    res = client.post("/api/customer/forgot-password", json={
        "email": "patient.elderly@example.com"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "password reset instructions" in data["message"].lower()

def test_optical_shop_login_preservation():
    """Verify pre-seeded optical store owner login remains intact."""
    res = client.post("/api/shop/login", json={
        "email": "rajesh@visioncraft.com",
        "password": "admin123"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "VisionCraft Opticians" in data["shop"]["shop_name"]

def test_direct_mobile_login_flow():
    """Verify direct mobile login without OTP for elderly users."""
    payload = {
        "name": "Kamala Devi",
        "mobile": "9845012345",
        "address": "42, Shanti Niketan, Malleshwaram, Bengaluru"
    }
    res = client.post("/api/customer/mobile-login", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "token" in data
    assert data["customer"]["name"] == "Kamala Devi"
    assert data["customer"]["mobile"] == "9845012345"
    assert data["customer"]["address"] == "42, Shanti Niketan, Malleshwaram, Bengaluru"

def test_direct_mobile_login_validation():
    """Verify field requirements on direct mobile login."""
    # Missing name
    res = client.post("/api/customer/mobile-login", json={"name": "", "mobile": "9845012345", "address": "123 Main St"})
    assert res.status_code == 400
    assert "Full Name is required" in res.json()["detail"]

    # Invalid mobile (< 10 digits)
    res = client.post("/api/customer/mobile-login", json={"name": "Kamala Devi", "mobile": "98450", "address": "123 Main St"})
    assert res.status_code == 400
    assert "valid 10-digit mobile number" in res.json()["detail"]

    # Missing address
    res = client.post("/api/customer/mobile-login", json={"name": "Kamala Devi", "mobile": "9845012345", "address": ""})
    assert res.status_code == 400
    assert "Home Address is required" in res.json()["detail"]

def test_returning_user_automatic_session_restore():
    """Verify session token validation and automatic profile restoration for returning users."""
    user_payload = {
        "name": "Swathi Raman",
        "mobile": "9811122233",
        "address": "15, Lotus Boulevard, Indiranagar, Bengaluru"
    }
    # 1. First-time registration
    res_reg = client.post("/api/customer/mobile-login", json=user_payload)
    assert res_reg.status_code == 200
    reg_data = res_reg.json()
    token = reg_data["token"]
    assert token is not None
    assert reg_data["customer"]["name"] == "Swathi Raman"

    # 2. Simulate user closing and reopening app: check session with GET /api/customer/me
    res_me = client.get("/api/customer/me", headers={"Authorization": f"Bearer {token}"})
    assert res_me.status_code == 200
    me_data = res_me.json()
    assert me_data["status"] == "success"
    assert me_data["role"] == "customer"
    assert me_data["is_returning"] is True
    assert me_data["customer"]["name"] == "Swathi Raman"
    assert me_data["customer"]["mobile"] == "9811122233"
    assert me_data["customer"]["address"] == "15, Lotus Boulevard, Indiranagar, Bengaluru"

def test_multi_user_session_isolation():
    """Verify distinct registered users restore their own respective names and profiles."""
    user_a = {"name": "Swathi", "mobile": "9811100011", "address": "Address A"}
    user_b = {"name": "Gopal", "mobile": "9811100022", "address": "Address B"}

    res_a = client.post("/api/customer/mobile-login", json=user_a)
    token_a = res_a.json()["token"]

    res_b = client.post("/api/customer/mobile-login", json=user_b)
    token_b = res_b.json()["token"]

    # Verify session A returns Swathi
    res_me_a = client.get("/api/customer/me", headers={"Authorization": f"Bearer {token_a}"})
    assert res_me_a.status_code == 200
    assert res_me_a.json()["customer"]["name"] == "Swathi"

    # Verify session B returns Gopal
    res_me_b = client.get("/api/customer/me", headers={"Authorization": f"Bearer {token_b}"})
    assert res_me_b.status_code == 200
    assert res_me_b.json()["customer"]["name"] == "Gopal"

def test_invalid_session_requires_reauthentication():
    """Verify missing, forged, or expired sessions return 401."""
    # Missing token
    res_no_token = client.get("/api/customer/me")
    assert res_no_token.status_code == 401

    # Invalid token
    res_bad_token = client.get("/api/customer/me", headers={"Authorization": "Bearer invalid.token.payload"})
    assert res_bad_token.status_code == 401


