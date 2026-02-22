interface ErrorBannerProps {
  message: string;
  onClose: () => void;
}

const ErrorBanner = ({ message, onClose }: ErrorBannerProps) => (
  <div className="error-message">
    <p className="error-text">⚠️ {message}</p>
    <button onClick={onClose} className="error-close">✕</button>
  </div>
);

export default ErrorBanner;
