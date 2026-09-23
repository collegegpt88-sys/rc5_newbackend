const router = require('express').Router();

// Meta webhook verification
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN)
    return res.status(200).send(challenge);
  return res.status(403).send('Forbidden');
});

// Incoming messages/statuses
router.post('/', (req, res) => {
  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return res.status(404).send('Not Found');
  (body.entry || []).forEach(entry =>
    (entry.changes || []).forEach(change => {
      (change.value?.messages || []).forEach(msg =>
        console.log(`WA message from ${msg.from}: ${msg.text?.body || '[non-text]'}`)
      );
    })
  );
  return res.status(200).send('EVENT_RECEIVED');
});

module.exports = router;
