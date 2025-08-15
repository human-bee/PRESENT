"use client";

import Link from "next/link";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">Terms of Service</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-gray-600 mb-4">
              <strong>Last updated:</strong> August 14, 2025
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Acceptance of Terms</h2>
            <p className="text-gray-700 mb-4">
              By accessing and using this website, you accept and agree to be bound by the terms 
              and provision of this agreement. If you do not agree to abide by the above, 
              please do not use this service.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Use License</h2>
            <p className="text-gray-700 mb-4">
              Permission is granted to temporarily download one copy of the materials on our 
              website for personal, non-commercial transitory viewing only. This is the grant 
              of a license, not a transfer of title.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. Disclaimer</h2>
            <p className="text-gray-700 mb-4">
              The materials on our website are provided on an 'as is' basis. We make no 
              warranties, expressed or implied, and hereby disclaim and negate all other 
              warranties including without limitation, implied warranties or conditions of 
              merchantability, fitness for a particular purpose, or non-infringement of 
              intellectual property or other violation of rights.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Limitations</h2>
            <p className="text-gray-700 mb-4">
              In no event shall we or our suppliers be liable for any damages (including, 
              without limitation, damages for loss of data or profit, or due to business 
              interruption) arising out of the use or inability to use the materials on our website.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Accuracy of Materials</h2>
            <p className="text-gray-700 mb-4">
              The materials appearing on our website could include technical, typographical, 
              or photographic errors. We do not warrant that any of the materials on our 
              website are accurate, complete, or current.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Links</h2>
            <p className="text-gray-700 mb-4">
              We have not reviewed all of the sites linked to our website and are not 
              responsible for the contents of any such linked site. The inclusion of any 
              link does not imply endorsement by us of the site.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Modifications</h2>
            <p className="text-gray-700 mb-4">
              We may revise these terms of service for our website at any time without notice. 
              By using this website you are agreeing to be bound by the then current version 
              of these Terms of Service.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Contact Information</h2>
            <p className="text-gray-700 mb-4">
              If you have any questions about these Terms of Service, please contact us at 
              <a href="mailto:legal@app.present.best" className="text-blue-600 hover:text-blue-800 ml-1">
                legal@app.present.best
              </a>
            </p>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <Link 
                href="/" 
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

