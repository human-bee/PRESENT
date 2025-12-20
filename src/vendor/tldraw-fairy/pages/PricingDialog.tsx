import React from 'react';

export function PricingDialog({ onClose }: { onClose(): void }) {
  return (
    <div style={{ padding: 16 }}>
      <h2>Fairy Pricing</h2>
      <p>Pricing is not configured in PRESENT yet.</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
