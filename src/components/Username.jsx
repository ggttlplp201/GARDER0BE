import { nameEffectOf } from '../lib/cosmetics';

// Renders a username with an equipped name-effect class. null/unknown → plain text.
export default function Username({ name, effect, className = '' }) {
  const fx = nameEffectOf(effect);
  return <span className={`${className}${fx ? ' ' + fx.nameEffectClass : ''}`}>{name}</span>;
}
