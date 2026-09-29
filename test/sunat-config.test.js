const assert = require('node:assert/strict');
const test = require('node:test');
const { getSunatConfig } = require('../services/sunat-config');

test('SUNAT integration is disabled unless beta is explicitly selected', () => {
  assert.deepEqual(getSunatConfig({}), { enabled: false, mode: 'disabled' });
});

test('beta uses SUNAT test credentials and the fixed beta endpoint only', () => {
  const config = getSunatConfig({
    SUNAT_MODE: 'beta',
    SUNAT_RUC: '20100066603',
    SUNAT_SOL_PASSWORD: 'never-use-this-secret',
  });

  assert.equal(config.endpoint, 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService');
  assert.equal(config.username, '20100066603MODDATOS');
  assert.equal(config.password, 'MODDATOS');
  assert.equal(Object.hasOwn(config, 'SUNAT_SOL_PASSWORD'), false);
});

test('beta rejects production mode, production runtime and invalid issuer RUC', () => {
  assert.throws(() => getSunatConfig({ SUNAT_MODE: 'production' }), /Solo están habilitados/);
  assert.throws(() => getSunatConfig({ SUNAT_MODE: 'beta', NODE_ENV: 'production', SUNAT_RUC: '20100066603' }), /NODE_ENV=production/);
  assert.throws(() => getSunatConfig({ SUNAT_MODE: 'beta', SUNAT_RUC: '123' }), /SUNAT_RUC/);
});

test('homologation uses the fixed HTTPS endpoint and composes its SOL credentials', () => {
  const config = getSunatConfig({
    SUNAT_MODE: 'homologation',
    SUNAT_RUC: '20100066603',
    SUNAT_SOL_USER: 'USUARIOSECUNDARIO',
    SUNAT_SOL_PASSWORD: 'test-only-secret',
  });

  assert.equal(config.endpoint, 'https://ww1.sunat.gob.pe/ol-ti-itcpgem-sqa/billService');
  assert.equal(config.username, '20100066603USUARIOSECUNDARIO');
  assert.equal(config.password, 'test-only-secret');
});

test('homologation requires local SOL credentials and cannot run in production', () => {
  assert.throws(() => getSunatConfig({ SUNAT_MODE: 'homologation', SUNAT_RUC: '20100066603' }), /SUNAT_SOL_USER/);
  assert.throws(() => getSunatConfig({
    SUNAT_MODE: 'homologation',
    NODE_ENV: 'production',
    SUNAT_RUC: '20100066603',
    SUNAT_SOL_USER: 'test-user',
    SUNAT_SOL_PASSWORD: 'test-only-secret',
  }), /NODE_ENV=production/);
});