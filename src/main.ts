import { calculateRadialLayout } from './features/athlete-shell/domain/radialHubGesture';
import './style.css';
const layout = calculateRadialLayout(390, 800, 'center', ['home', 'train', 'profile']);
const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Fixture root missing');
app.textContent = `PUBLIC CI FIXTURE — NOT PRODUCTION DATA (${layout.destinations.length} targets)`;
