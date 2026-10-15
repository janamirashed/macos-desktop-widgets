import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

export class WidgetDrawing {
    _text(cr, str, x, y, px, rgba, {weight = Pango.Weight.NORMAL, right = false, maxW = 0} = {}) {
        const layout = PangoCairo.create_layout(cr);
        const desc = Pango.FontDescription.from_string('SF Pro');
        desc.set_absolute_size(Math.max(1, Math.round(px)) * Pango.SCALE);
        desc.set_weight(weight);
        layout.set_font_description(desc);

        if (maxW) {
            layout.set_width(Math.round(maxW) * Pango.SCALE);
            layout.set_ellipsize(Pango.EllipsizeMode.END);
        }
        layout.set_text(str ?? '', -1);
        const [lw, lh] = layout.get_pixel_size();
        cr.setSourceRGBA(...rgba);
        cr.moveTo(right ? x - lw : x, y);
        PangoCairo.show_layout(cr, layout);
        return {w: lw, h: lh};
    }

    _roundRect(cr, x, y, w, h, r) {
        cr.newSubPath();
        cr.arc(x+w-r, y+r, r, -Math.PI/2, 0);
        cr.arc(x+w-r, y+h-r, r, 0, Math.PI/2);
        cr.arc(x+r, y+h-r, r, Math.PI/2, Math.PI);
        cr.arc(x+r, y+r, r, Math.PI, 3*Math.PI/2);
        cr.closePath();
    }

}
