/**
 * Roue contextuelle (radial menu) — composant générique.
 *
 * Ouvre un menu radial à un point lng/lat sur la carte. Les options sont
 * disposées sur un arc. La roue suit la carte (pan/zoom). Fermée par :
 *  - tap sur le bouton central (close)
 *  - tap sur une option
 *  - tap en dehors
 *  - touche Échap
 *  - destroy() programmatique
 *
 * Support sous-menus : une option peut renvoyer une nouvelle liste d'options
 * via `children: () => [...]` → la roue se reconstruit.
 *
 * Design : verre dépoli sombre, icônes Material, label au survol, animé.
 */
export class Wheel {
    /**
     * @param {Object} opts
     *   @param {maplibregl.Map} opts.map
     *   @param {{lng:number,lat:number}|null} opts.lngLat  Position carte (null = centre écran)
     *   @param {string} [opts.title]
     *   @param {string} [opts.centerIcon='close']  Icône du bouton central
     *   @param {Array<{
     *     id?:string, icon:string, label:string, color?:string, bg?:string,
     *     action?:(wheel:Wheel)=>void, children?:()=>Array
     *   }>} opts.options
     *   @param {number} [opts.radius=78]  Rayon de l'arc
     *   @param {Function} [opts.onClose]
     */
    constructor(opts) {
        this.map = opts.map;
        this.lngLat = opts.lngLat;
        this.title = opts.title;
        this.centerIcon = opts.centerIcon || 'close';
        this.options = opts.options || [];
        this.radius = opts.radius || 78;
        this.onClose = opts.onClose;
        this.element = null;
        this._onMove = this._onMove.bind(this);
        this._onOutside = this._onOutside.bind(this);
        this._onKey = this._onKey.bind(this);
        this._destroyed = false;
        this._mountedAt = 0;
    }

    open() {
        if (this.element) return;
        this.element = this._buildElement();
        // On monte dans le container de la carte (positionnement absolute)
        const parent = this.map ? this.map.getContainer() : document.body;
        parent.appendChild(this.element);
        this._position();
        if (this.map) {
            this.map.on('move', this._onMove);
            this.map.on('zoom', this._onMove);
        }
        // Ignore le 1er pointerdown (celui qui a ouvert la roue)
        this._mountedAt = Date.now();
        // Capture pour intercepter avant que le map handler ne réagisse
        document.addEventListener('pointerdown', this._onOutside, { capture: true });
        document.addEventListener('touchstart', this._onOutside, { capture: true, passive: true });
        document.addEventListener('keydown', this._onKey);
        // Anim d'apparition
        requestAnimationFrame(() => {
            if (this.element) this.element.classList.add('open');
        });
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this.element) {
            try { this.element.remove(); } catch (_) {}
            this.element = null;
        }
        if (this.map) {
            try { this.map.off('move', this._onMove); } catch (_) {}
            try { this.map.off('zoom', this._onMove); } catch (_) {}
        }
        document.removeEventListener('pointerdown', this._onOutside, { capture: true });
        document.removeEventListener('touchstart', this._onOutside, { capture: true });
        document.removeEventListener('keydown', this._onKey);
        if (this.onClose) {
            try { this.onClose(); } catch (_) {}
        }
    }

    /** Remplace dynamiquement les options et redéploie la roue. */
    setOptions(options, { title, centerIcon } = {}) {
        this.options = options || [];
        if (title !== undefined) this.title = title;
        if (centerIcon !== undefined) this.centerIcon = centerIcon;
        if (!this.element) return;
        // Reconstruction
        const parent = this.element.parentElement;
        const oldEl = this.element;
        this.element = this._buildElement();
        if (parent) {
            parent.insertBefore(this.element, oldEl);
            oldEl.remove();
        }
        this._position();
        requestAnimationFrame(() => {
            if (this.element) this.element.classList.add('open');
        });
    }

    _onMove() { this._position(); }

    _onOutside(ev) {
        if (!this.element) return;
        // Ignore l'événement qui a probablement ouvert la roue (même tick que open())
        if (Date.now() - this._mountedAt < 120) return;
        if (!this.element.contains(ev.target)) {
            this.destroy();
        }
    }

    _onKey(ev) {
        if (ev.key === 'Escape') this.destroy();
    }

    _position() {
        if (!this.element || !this.map) return;
        if (!this.lngLat) {
            // Centre écran
            const r = this.map.getContainer().getBoundingClientRect();
            this.element.style.left = `${r.width / 2}px`;
            this.element.style.top  = `${r.height / 2}px`;
            return;
        }
        const p = this.map.project(this.lngLat);
        this.element.style.left = `${p.x}px`;
        this.element.style.top  = `${p.y}px`;
    }

    _buildElement() {
        const n = this.options.length;
        // Rayon adaptatif : plus compact sur mobile (< 480px de largeur écran)
        const vw = (typeof window !== 'undefined' ? window.innerWidth : 1024);
        const radius = vw < 480 ? Math.min(this.radius, 86) : Math.max(this.radius, 96);
        // Pour 1-2 options, on étale en arc semi-circulaire pour éviter les superpositions.
        const arcSpan = n <= 2 ? Math.PI : 2 * Math.PI;
        const arcStart = n <= 2 ? -Math.PI / 2 - arcSpan / 2 : -Math.PI / 2; // 12h
        const btnSize = vw < 480 ? 52 : 58;
        const wrap = document.createElement('div');
        wrap.className = 'plan-wheel';
        wrap.style.cssText = `
            position: absolute;
            width: ${radius * 2 + btnSize + 36}px;
            height: ${radius * 2 + btnSize + 36}px;
            transform: translate(-50%, -50%) scale(0.85);
            opacity: 0;
            transition: transform 160ms cubic-bezier(.34,1.56,.64,1), opacity 140ms ease-out;
            z-index: 60;
            pointer-events: none;
        `;

        // Cercle de fond (verre dépoli)
        const bg = document.createElement('div');
        bg.style.cssText = `
            position: absolute; inset: 0;
            border-radius: 50%;
            background: radial-gradient(circle at center, rgba(20,24,32,0.55) 0%, rgba(20,24,32,0.10) 70%, transparent 100%);
            pointer-events: none;
        `;
        wrap.appendChild(bg);

        // Bouton central (close ou back) - plus grand et explicite
        const center = document.createElement('button');
        center.type = 'button';
        center.className = 'plan-wheel-center';
        const isBack = this.centerIcon === 'arrow_back';
        center.title = isBack ? 'Retour' : 'Fermer';
        center.style.cssText = `
            position: absolute;
            left: 50%; top: 50%;
            transform: translate(-50%, -50%);
            width: 54px; height: 54px;
            border-radius: 50%;
            background: ${isBack ? 'rgba(59,130,246,0.95)' : 'rgba(20,24,32,0.95)'};
            border: 2px solid ${isBack ? '#60a5fa' : 'rgba(255,255,255,0.35)'};
            color: #fff;
            cursor: pointer;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 1px;
            pointer-events: auto;
            box-shadow: 0 4px 16px rgba(0,0,0,0.55);
            transition: transform 100ms ease;
            touch-action: none;
            font-family: var(--font-ui, sans-serif);
        `;
        center.innerHTML = `
            <span class="material-symbols-outlined" style="font-size: 22px; line-height: 1;">${this.centerIcon}</span>
            <span style="font-size: 9px; font-weight: 700; letter-spacing: 0.5px; opacity: 0.85;">${isBack ? 'RETOUR' : 'FERMER'}</span>
        `;
        center.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        center.onclick = (ev) => { ev.stopPropagation(); this.destroy(); };
        wrap.appendChild(center);

        // Titre optionnel (sous la roue)
        if (this.title) {
            const t = document.createElement('div');
            t.style.cssText = `
                position: absolute;
                left: 50%; bottom: -28px;
                transform: translateX(-50%);
                background: rgba(20,24,32,0.92);
                color: #fff;
                padding: 3px 10px;
                border-radius: 12px;
                font-family: var(--font-ui, sans-serif);
                font-size: 0.78em;
                font-weight: 600;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            `;
            t.textContent = this.title;
            wrap.appendChild(t);
        }

        // Boutons en arc avec labels TOUJOURS visibles (mobile-friendly)
        this.options.forEach((opt, i) => {
            const angle = arcStart + (n === 1 ? 0 : (i / Math.max(1, n - (arcSpan >= 2 * Math.PI ? 0 : 1))) * arcSpan);
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const b = document.createElement('button');
            b.type = 'button';
            b.title = opt.label;
            const bg2 = opt.bg || 'rgba(20,24,32,0.92)';
            const col = opt.color || '#fff';
            const border = opt.color || (opt.bg ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)');
            b.style.cssText = `
                position: absolute;
                left: 50%; top: 50%;
                transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px));
                width: ${btnSize}px; height: ${btnSize}px;
                border-radius: 50%;
                background: ${bg2};
                border: 2px solid ${border};
                color: ${col};
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                pointer-events: auto;
                box-shadow: 0 3px 12px rgba(0,0,0,0.55);
                transition: transform 100ms ease, box-shadow 100ms ease;
                touch-action: none;
                padding: 0;
            `;
            b.innerHTML = `<span class="material-symbols-outlined" style="font-size: ${btnSize >= 56 ? 26 : 22}px; line-height: 1;">${opt.icon}</span>`;

            // LABEL TOUJOURS VISIBLE en dessous du bouton, sur fond foncé
            // Position : ajustée selon l'angle pour éviter la superposition avec d'autres
            const labelBelow = y > -radius * 0.3;          // si bouton dans la moitié basse/centre → label dessous
            const labelOffset = labelBelow ? (btnSize / 2 + 6) : -(btnSize / 2 + 16);
            const tip = document.createElement('span');
            tip.textContent = opt.label;
            tip.style.cssText = `
                position: absolute;
                top: calc(50% + ${labelOffset}px);
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.85);
                color: #fff;
                font-family: var(--font-ui, sans-serif);
                font-size: 0.7em;
                font-weight: 700;
                letter-spacing: 0.3px;
                padding: 2px 7px;
                border-radius: 8px;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 1px 4px rgba(0,0,0,0.5);
                max-width: 110px;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            b.appendChild(tip);

            b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
            b.onclick = (ev) => {
                ev.stopPropagation();
                if (opt.children) {
                    const childOpts = (typeof opt.children === 'function') ? opt.children() : opt.children;
                    this.setOptions(childOpts, { title: opt.label, centerIcon: 'arrow_back' });
                    // Quand on est dans un sous-menu, le bouton central revient au précédent
                    const center2 = this.element.querySelector('.plan-wheel-center');
                    if (center2) {
                        center2.onclick = (e) => {
                            e.stopPropagation();
                            this.setOptions(this._initialOptions || this.options, { title: this._initialTitle, centerIcon: 'close' });
                            const c3 = this.element.querySelector('.plan-wheel-center');
                            if (c3) c3.onclick = (ee) => { ee.stopPropagation(); this.destroy(); };
                        };
                    }
                    return;
                }
                if (opt.action) {
                    try { opt.action(this); } catch (e) { console.error('[Wheel] action erreur:', e); }
                }
                if (!opt.keepOpen) this.destroy();
            };
            wrap.appendChild(b);
        });

        // Mémorise l'état initial pour le "back"
        this._initialOptions = this._initialOptions || this.options;
        this._initialTitle = this._initialTitle || this.title;

        return wrap;
    }
}

// CSS de l'animation d'ouverture (injecté une fois)
//
// IMPORTANT : on NE TOUCHE PAS au `transform` des boutons radiaux en :active.
// Leur transform encode leur position radiale ([translate ... + position]); le
// modifier ferait sauter le bouton (ex : vers le centre). Feedback visuel par
// filter/box-shadow uniquement, jamais par transform.
if (typeof document !== 'undefined' && !document.getElementById('plan-wheel-style')) {
    const s = document.createElement('style');
    s.id = 'plan-wheel-style';
    s.textContent = `
        .plan-wheel.open { opacity: 1 !important; transform: translate(-50%, -50%) scale(1) !important; }
        /* Feedback de clic SANS toucher au transform (qui contient la position) */
        .plan-wheel button:active {
            filter: brightness(0.82);
            box-shadow: 0 1px 4px rgba(0,0,0,0.75) inset, 0 1px 5px rgba(0,0,0,0.45);
        }
        /* Centre : centré sur le point d'ancrage, scale ok sans déplacement */
        .plan-wheel-center:active {
            transform: translate(-50%, -50%) scale(0.94) !important;
        }
    `;
    document.head.appendChild(s);
}
