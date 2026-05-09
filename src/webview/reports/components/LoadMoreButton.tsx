import React from 'react';

interface LoadMoreButtonProps {
  onClick: () => void;
  loading: boolean;
}

export default function LoadMoreButton({ onClick, loading }: LoadMoreButtonProps) {
  return (
    <button
      className="load-more-btn"
      onClick={onClick}
      disabled={loading}
    >
      {loading ? 'Loading...' : 'Load older'}
    </button>
  );
}
