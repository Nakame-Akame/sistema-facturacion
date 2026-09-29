const BETA_ENDPOINT = 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';
const HOMOLOGATION_ENDPOINT = 'https://ww1.sunat.gob.pe/ol-ti-itcpgem-sqa/billService';

function getSunatConfig(environment = process.env) {
  const mode = (environment.SUNAT_MODE || 'disabled').trim().toLowerCase();
  if (mode === 'disabled') return { enabled: false, mode };
  if (!['beta', 'homologation'].includes(mode)) {
    throw new Error('Solo están habilitados los entornos de prueba de SUNAT; producción no está implementada.');
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('El entorno beta de SUNAT no puede usarse con NODE_ENV=production.');
  }

  const ruc = (environment.SUNAT_RUC || '').trim();
  if (!/^\d{11}$/.test(ruc)) {
    throw new Error('SUNAT_RUC debe contener los 11 dígitos del emisor para usar el beta.');
  }

  if (mode === 'beta') {
    return {
      enabled: true,
      mode,
      endpoint: BETA_ENDPOINT,
      username: `${ruc}MODDATOS`,
      password: 'MODDATOS',
      ruc,
    };
  }

  const solUser = (environment.SUNAT_SOL_USER || '').trim();
  const solPassword = environment.SUNAT_SOL_PASSWORD || '';
  if (!solUser || !solPassword) {
    throw new Error('Homologación requiere SUNAT_SOL_USER y SUNAT_SOL_PASSWORD configurados localmente.');
  }

  return {
    enabled: true,
    mode,
    endpoint: HOMOLOGATION_ENDPOINT,
    username: `${ruc}${solUser}`,
    password: solPassword,
    ruc,
  };
}

module.exports = { getSunatConfig };