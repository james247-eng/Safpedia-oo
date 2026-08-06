// js/email-service.js
import emailjs from 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';

// Configuration constants - Replace with your actual EmailJS IDs
const EMAILJS_SERVICE_ID = 'service_121xb34';
const EMAILJS_TEMPLATE_ID = 'template_und2q98';
const EMAILJS_PUBLIC_KEY = '1CglFCDiNLYkK41a-';

// Initialize EmailJS
emailjs.init(EMAILJS_PUBLIC_KEY);

/**
 * Core dynamic dispatcher using a single template format.
 * Expected EmailJS Template Variables:
 * {{to_email}}, {{to_name}}, {{subject}}, {{headline}}, {{body_content}}, {{action_url}}, {{action_text}}
 */
async function dispatchDynamicEmail(payload) {
    try {
        const response = await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email: payload.toEmail,
            to_name: payload.toName || 'Valued User',
            subject: payload.subject,
            headline: payload.headline,
            body_content: payload.bodyContent,
            action_url: payload.actionUrl || 'https://safpedia-oo.vercel.app',
            action_text: payload.actionText || 'View Dashboard'
        });
        console.log('Email dispatched successfully:', response.status, response.text);
        return { success: true, response };
    } catch (error) {
        console.error('Email dispatch failure (non-blocking):', error);
        return { success: false, error };
    }
}

// ====================================================================
// ACTION-SPECIFIC HELPERS
// ====================================================================

// 1. Buyer Order Confirmation
export async function sendBuyerOrderConfirmation({ email, name, orderRef, totalAmount, itemTitle }) {
    return dispatchDynamicEmail({
        toEmail: email,
        toName: name,
        subject: `Order Confirmed #${orderRef} - Safpedia Marketplace`,
        headline: `Thank You for Your Order!`,
        bodyContent: `Your purchase of "${itemTitle}" (Order #${orderRef}) totaling ₦${totalAmount.toLocaleString()} was successful. The vendor has been notified to process your order.`,
        actionUrl: `https://safpedia-oo.vercel.app/users/dashboard.html`,
        actionText: `View Order Details`
    });
}

// 2. Vendor New Order Alert
export async function sendVendorNewOrderAlert({ vendorEmail, vendorName, orderRef, itemTitle, qty, unit, earnings }) {
    const unitLabel = unit ? ` ${unit}(s)` : '';
    return dispatchDynamicEmail({
        toEmail: vendorEmail,
        toName: vendorName,
        subject: `New Sale Alert! Order #${orderRef}`,
        headline: `You Made a Sale! 🛒`,
        bodyContent: `Great news! You received an order for ${qty}${unitLabel} of "${itemTitle}". Earnings credited to your pending balance: ₦${earnings.toLocaleString()}. Please process this order promptly.`,
        actionUrl: `https://safpedia-oo.vercel.app/seller-dashboard.html?tab=orders`,
        actionText: `Manage Order`
    });
}

// 3. Buyer Shipping Notification
export async function sendBuyerShippingAlert({ buyerEmail, buyerName, itemTitle, vendorNote }) {
    const noteText = vendorNote ? `Vendor Note: "${vendorNote}"` : '';
    return dispatchDynamicEmail({
        toEmail: buyerEmail,
        toName: buyerName,
        subject: `Your Order is On Its Way! 📦`,
        headline: `Item Shipped!`,
        bodyContent: `Your order for "${itemTitle}" has been shipped by the seller. ${noteText}`,
        actionUrl: `https://safpedia-oo.vercel.app/users/dashboard.html`,
        actionText: `Track Package`
    });
}

// 4. Payout Status Alert (Vendor)
export async function sendPayoutStatusAlert({ vendorEmail, vendorName, amount, status, message }) {
    const isSuccess = status === 'success';
    return dispatchDynamicEmail({
        toEmail: vendorEmail,
        toName: vendorName,
        subject: isSuccess ? `Payout Processed: ₦${amount.toLocaleString()}` : `Payout Update: Action Required`,
        headline: isSuccess ? `Withdrawal Successful! ` : `Payout Issue Alert`,
        bodyContent: message || (isSuccess 
            ? `Your payout of ₦${amount.toLocaleString()} has been successfully transferred to your bank account.`
            : `Your payout request of ₦${amount.toLocaleString()} could not be processed. Funds have been returned to your balance.`),
        actionUrl: `https://safpedia-oo.vercel.app/seller-dashboard.html?tab=payouts`,
        actionText: `View Payouts`
    });
}

// 5. Vendor Stock Warning
export async function sendStockWarningAlert({ vendorEmail, vendorName, itemTitle, stockRemaining }) {
    return dispatchDynamicEmail({
        toEmail: vendorEmail,
        toName: vendorName,
        subject: `Low Stock Alert: ${itemTitle}`,
        headline: `Inventory Warning ⚠️`,
        bodyContent: `Your listed product "${itemTitle}" only has ${stockRemaining} unit(s) left in stock. Update your inventory to prevent missing sales.`,
        actionUrl: `https://safpedia-oo.vercel.app/seller-dashboard.html?tab=products`,
        actionText: `Update Inventory`
    });
}