import { Link } from 'react-router-dom';

export default function Legal() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-8">
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
        
        <p className="text-gray-600 mb-4">Last updated: April 2026</p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">1. Acceptance of Terms</h2>
        <p className="text-gray-600 mb-4">
          By accessing and using ClearRoute, you accept and agree to be bound by the terms and provision of this agreement.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">2. Use License</h2>
        <p className="text-gray-600 mb-4">
          ClearRoute is provided for lawful business purposes only. You may not use our service for any illegal purpose.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">3. Data Security</h2>
        <p className="text-gray-600 mb-4">
          We implement appropriate security measures to protect your data. However, no method of transmission over the internet is 100% secure.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">4. Limitation of Liability</h2>
        <p className="text-gray-600 mb-4">
          ClearRoute shall not be liable for any indirect, incidental, or consequential damages arising from your use of the service.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">5. Contact</h2>
        <p className="text-gray-600 mb-4">
          For questions about these terms, contact: hello@clearroute.co.uk
        </p>
        
        <div className="mt-8 pt-6 border-t">
          <Link to="/login" className="text-blue-600 hover:underline">Back to Login</Link>
        </div>
      </div>
    </div>
  );
}