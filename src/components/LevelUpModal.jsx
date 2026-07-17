export default function LevelUpModal({ event, onClose }) {
  if (!event) return null;
  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal levelup-modal" onClick={e => e.stopPropagation()}>
        <div className="levelup-kicker">LEVEL UP</div>
        <div className="levelup-level">LVL {event.leveled_to}</div>
        <div className="levelup-coins">+{event.coins_awarded} COINS</div>
        <div className="modal-actions">
          <button onClick={onClose}>NICE</button>
        </div>
      </div>
    </div>
  );
}
