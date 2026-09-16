import logoSvg from '../images/lamai-logo.svg?raw';

export const logoUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg)}`;
export { logoSvg };

export function paintLogos(root = document) {
  root.querySelectorAll('[data-lamai-logo]').forEach((node) => {
    if (node.querySelector('svg.lamai-mark')) return;
    node.innerHTML = logoSvg;
  });
}

export default logoUrl;
