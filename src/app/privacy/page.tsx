'use client';

import Link from 'next/link';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>

          <div className="prose prose-lg max-w-none">
            <p className="text-gray-600 mb-4">
              <strong>Last updated:</strong> August 14, 2025
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">
              1. Information We Collect
            </h2>
            <p className="text-gray-700 mb-4">
              We collect information you provide directly to us, such as when you create an account,
              use our services, or contact us for support. This may include your name, email
              address, and any other information you choose to provide.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">
              2. How We Use Your Information
            </h2>
            <p className="text-gray-700 mb-4">
              We use the information we collect to provide, maintain, and improve our services, to
              communicate with you, and to develop new features and functionality.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">
              3. Information Sharing
            </h2>
            <p className="text-gray-700 mb-4">
              We do not sell, trade, or otherwise transfer your personal information to third
              parties without your consent, except as described in this policy or as required by
              law.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Data Security</h2>
            <p className="text-gray-700 mb-4">
              We implement appropriate security measures to protect your personal information
              against unauthorized access, alteration, disclosure, or destruction.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Your Rights</h2>
            <p className="text-gray-700 mb-4">
              You have the right to access, update, or delete your personal information. You may
              also opt out of certain communications from us.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Contact Us</h2>
            <p className="text-gray-700 mb-4">
              If you have any questions about this Privacy Policy, please contact us at
              <a
                href="mailto:privacy@app.present.best"
                className="text-blue-600 hover:text-blue-800 ml-1"
              >
                privacy@app.present.best
              </a>
            </p>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
