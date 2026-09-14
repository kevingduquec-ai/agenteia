/**
 * Widget embebible de Prefi.
 *
 * Uso en cualquier pagina del marketplace (o de un aliado):
 *
 *   <script src="https://TU-DOMINIO/embed.js" defer></script>
 *
 * No requiere React ni ninguna otra dependencia del sitio que lo incluye:
 * crea una burbuja flotante fija en la esquina inferior derecha que, al
 * hacer clic, abre un <iframe> con el chat completo. En pantallas
 * pequeñas (celulares) el chat ocupa toda la pantalla en vez de un
 * recuadro flotante, para que siga siendo comodo de usar con el dedo.
 */
var ICON_CHAT =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

var ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

(function () {
  if (window.__prefieroIaWidgetLoaded) return;
  window.__prefieroIaWidgetLoaded = true;

  var MOBILE_BREAKPOINT = 480;
  var currentScript = document.currentScript;
  var origin = resolveOrigin(currentScript);

  var isOpen = false;

  var bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.setAttribute('aria-label', 'Abrir chat de Prefi');
  bubble.setAttribute('aria-expanded', 'false');
  bubble.innerHTML = ICON_CHAT;
  applyStyles(bubble, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    zIndex: '2147483000',
    background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
    boxShadow: '0 10px 28px rgba(124,58,237,.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform .15s ease, box-shadow .15s ease',
    padding: '0',
  });
  bubble.addEventListener('mouseenter', function () {
    bubble.style.transform = 'scale(1.06)';
  });
  bubble.addEventListener('mouseleave', function () {
    bubble.style.transform = 'scale(1)';
  });

  var frameWrap = document.createElement('div');
  applyStyles(frameWrap, {
    position: 'fixed',
    display: 'none',
    opacity: '0',
    transform: 'translateY(16px)',
    zIndex: '2147483000',
    overflow: 'hidden',
    borderRadius: '20px',
    boxShadow: '0 24px 64px rgba(15,23,42,.28)',
    background: '#fff',
    transition: 'opacity .18s ease, transform .18s ease',
  });

  // La ruta de esta pagina (host) se manda al chat para que sepa, por
  // ejemplo, si el usuario esta viendo una ficha de producto especifica
  // (seccion 33-34) — nunca se manda nombre/precio, solo la ruta; el
  // servidor la resuelve contra el catalogo real.
  var iframe = document.createElement('iframe');
  iframe.title = 'Prefi';
  iframe.setAttribute('src', origin + '/widget?path=' + encodeURIComponent(window.location.pathname));
  applyStyles(iframe, { width: '100%', height: '100%', border: '0', display: 'block' });
  frameWrap.appendChild(iframe);

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function layoutFrame() {
    if (isMobile()) {
      applyStyles(frameWrap, {
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        width: '100vw',
        height: '100dvh',
        borderRadius: '0',
      });
      // A pantalla completa el chat ya usa toda la esquina inferior
      // (input, boton de enviar) — el boton de cerrar se mueve arriba
      // para no taparlo.
      applyStyles(bubble, { top: '14px', bottom: 'auto', right: '14px', width: '44px', height: '44px' });
    } else {
      applyStyles(frameWrap, {
        top: 'auto',
        left: 'auto',
        bottom: '92px',
        right: '20px',
        width: '380px',
        height: '620px',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 112px)',
        borderRadius: '20px',
      });
      applyStyles(bubble, { top: 'auto', bottom: '20px', right: '20px', width: '60px', height: '60px' });
    }
  }

  function open() {
    isOpen = true;
    layoutFrame();
    frameWrap.style.display = 'block';
    bubble.setAttribute('aria-expanded', 'true');
    bubble.setAttribute('aria-label', 'Cerrar chat de Prefi');
    bubble.innerHTML = ICON_CLOSE;
    requestAnimationFrame(function () {
      frameWrap.style.opacity = '1';
      frameWrap.style.transform = 'translateY(0)';
    });
  }

  function close() {
    isOpen = false;
    frameWrap.style.opacity = '0';
    frameWrap.style.transform = 'translateY(16px)';
    bubble.setAttribute('aria-expanded', 'false');
    bubble.setAttribute('aria-label', 'Abrir chat de Prefi');
    bubble.innerHTML = ICON_CHAT;
    // Vuelve el boton a su posicion de reposo (pudo haberse movido arriba
    // para no tapar el chat en pantalla completa).
    applyStyles(bubble, { top: 'auto', bottom: '20px', right: '20px', width: '60px', height: '60px' });
    window.setTimeout(function () {
      if (!isOpen) frameWrap.style.display = 'none';
    }, 200);
  }

  bubble.addEventListener('click', function () {
    if (isOpen) close();
    else open();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && isOpen) close();
  });

  // El chat (dentro del iframe) pide cerrarse cuando el usuario hace clic
  // en su propio boton de cerrar (visible solo estando embebido).
  window.addEventListener('message', function (event) {
    if (event.source === iframe.contentWindow && event.data && event.data.type === 'prefiero-ia:close') {
      close();
    }
  });

  window.addEventListener('resize', function () {
    if (isOpen) layoutFrame();
  });

  function mount() {
    document.body.appendChild(frameWrap);
    document.body.appendChild(bubble);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  function resolveOrigin(scriptEl) {
    var explicit = scriptEl && scriptEl.getAttribute('data-origin');
    if (explicit) return explicit.replace(/\/$/, '');
    var src = scriptEl && scriptEl.src;
    if (src) {
      try {
        return new URL(src).origin;
      } catch (err) {
        /* sigue al fallback */
      }
    }
    return window.location.origin;
  }

  function applyStyles(el, styles) {
    for (var key in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, key)) {
        el.style[key] = styles[key];
      }
    }
  }
})();
