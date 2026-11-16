/**
 * Home registrations (SPEC 4.2). Plain data.
 *
 * Home owns no records and no Next items: it shows the top of the one queue
 * (kernel lib_next) and reads the other modules' contracts. It adds the
 * firm's picture to app.today and the digest time to the settings.
 */
module.exports = {
  today: 'lib_home.today',
  settingsKeys: { home: { digest_time: '07:00' } },
};
