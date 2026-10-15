// Quintic-superellipse ("squircle", n = 5 -- the Apple app-icon curve) helpers.
//
// squirclePath() traces a rounded rectangle whose corner arcs are Lamé
// quarter-curves: 4 straight edges + 4 corner arcs, each corner sampled
// densely so large near-rectangular shapes don't facet.

// Lamé-curve parametrisation of the unit superellipse quadrant:
//   x = sign(cos t) * |cos t|^(2/n),  y = sign(sin t) * |sin t|^(2/n)
function lame(t, n) {
    const k = 2 / n;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [
        Math.sign(c) * Math.pow(Math.abs(c), k),
        Math.sign(s) * Math.pow(Math.abs(s), k),
    ];
}

/**
 * Trace a filled squircle centred at (cx, cy) with half-extents (hw, hh),
 * corner radius r and exponent n into a Cairo context. `steps` is the number
 * of segments per corner arc.
 */
export function squirclePath(cr, cx, cy, hw, hh, r, n = 5, steps = 24) {
    r = Math.max(0, Math.min(r, hw, hh));
    const ix = hw - r; // corner-centre x offset
    const iy = hh - r;

    // corner: centre (ox,oy), sweep angle a0..a0+PI/2
    const corner = (ox, oy, a0) => {
        for (let i = 0; i <= steps; i++) {
            const t = a0 + (i / steps) * (Math.PI / 2);
            const [lx, ly] = lame(t, n);
            cr.lineTo(cx + ox + lx * r, cy + oy + ly * r);
        }
    };

    cr.moveTo(cx - ix, cy - hh);          // top edge, left end
    cr.lineTo(cx + ix, cy - hh);          // -> top edge, right end
    corner(ix, -iy, -Math.PI / 2);        // top-right corner (up -> right)
    cr.lineTo(cx + hw, cy + iy);          // right edge
    corner(ix, iy, 0);                    // bottom-right (right -> down)
    cr.lineTo(cx - ix, cy + hh);          // bottom edge
    corner(-ix, iy, Math.PI / 2);         // bottom-left (down -> left)
    cr.lineTo(cx - hw, cy - iy);          // left edge
    corner(-ix, -iy, Math.PI);            // top-left (left -> up)
    cr.closePath();
}

// --- legacy ray-hit (still used by the digital clock tick ring, which needs
// a point on the squircle boundary along an arbitrary radial direction) ----

export function squircleLevel(x, y, hw, hh, r, n) {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const qx = ax - hw + r;
    const qy = ay - hh + r;
    if (qx <= 0 && qy <= 0)
        return Math.max(qx, qy) - r;
    const mx = Math.max(qx, 0);
    const my = Math.max(qy, 0);
    const arc = Math.pow(Math.pow(mx, n) + Math.pow(my, n), 1 / n);
    return Math.min(Math.max(qx, qy), 0) + arc - r;
}

export function squircleRayHit(dx, dy, hw, hh, r, n) {
    const tX = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity;
    const tY = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity;
    let tHi = Math.min(tX, tY);
    let tLo = 0;
    for (let i = 0; i < 24; i++) {
        const tm = 0.5 * (tLo + tHi);
        if (squircleLevel(tm * dx, tm * dy, hw, hh, r, n) < 0)
            tLo = tm;
        else
            tHi = tm;
    }
    const t = 0.5 * (tLo + tHi);
    return [t * dx, t * dy];
}
