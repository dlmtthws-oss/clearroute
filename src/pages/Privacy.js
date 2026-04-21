import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-8">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        
        <p className="text-gray-600 mb-4">Last updated: April 2026</p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">1. Information We Collect</h2>
        <p className="text-gray-600 mb-4">
          We collect information you provide directly to us, including name, email, phone number, and business data such as customer information, invoices, and business records.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">2. How We Use Your Information</h2>
        <p className="text-gray-600 mb-4">
          We use your information to provide and improve our services, communicate with you, and comply with legal obligations.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">3. Data Storage</h2>
        <p className="text-gray-600 mb-4">
          Your data is stored on secure servers in the UK/EU. We use industry-standard encryption and security measures.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">4. Data Sharing</h2>
        <p className="text-gray-600 mb-4">
          We do not sell your data. We may share data with service providers who help us operate (e.g., cloud hosting, payment processing).
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">5. Your Rights</h2>
        <p className="text-gray-600 mb-4">
          Under GDPR, you have the right to access, correct, or delete your personal data. Contact us to exercise these rights.
        </p>
        
        <h2 className="text-xl font-semibold mt-6 mb-3">6. Contact</h2>
        <p className="text-gray-600 mb-4">
          For privacy questions, contact: hello@clearroute.co.uk
        </p>
        
        <div className="mt-8 pt-6 border-t">
          <Link to="/login" className="text-blue-600 hover:underline">Back to Login</Link>
        </div>
      </div>
    </div>
  );
}