const PERMISOS_POR_ROL = Object.freeze({
	admin: ['*'],
	vendedor: [
		'clientes:ver',
		'clientes:crear',
		'productos:ver',
		'comprobantes:ver',
		'comprobantes:crear_factura',
		'comprobantes:crear_boleta',
		'comprobantes:crear_nota_pedido',
		'comprobantes:crear_guia_remision',
		'comprobantes:crear_cotizacion',
		'comprobantes:pagar',
		'reportes:ver',
	],
});

const ROLES_VALIDOS = Object.keys(PERMISOS_POR_ROL);

function tienePermiso(rol, permiso) {
	const permisos = PERMISOS_POR_ROL[rol] || [];
	return permisos.includes('*') || permisos.includes(permiso);
}

function requierePermiso(permiso) {
	return (req, res, next) => {
		if (!req.session?.usuario) {
			return res.status(401).json({ ok: false, error: 'Debes iniciar sesión' });
		}
		if (!tienePermiso(req.session.usuario.rol, permiso)) {
			return res.status(403).json({ ok: false, error: 'Acceso denegado' });
		}
		next();
	};
}

module.exports = { PERMISOS_POR_ROL, ROLES_VALIDOS, tienePermiso, requierePermiso };
