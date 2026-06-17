require('dotenv').config();
const express = require('express');
const cors = require('cors');
const migrate = require('./migrate');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const userListRoutes = require('./routes/userList');
const trainingMatrixRoutes = require('./routes/trainingMatrix');
const templateRoutes = require('./routes/templates');
const generationRoutes = require('./routes/generation');
const campaignRoutes = require('./routes/campaigns');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', userListRoutes);
app.use('/api/projects', trainingMatrixRoutes);
app.use('/api/projects', templateRoutes);
app.use('/api/projects', generationRoutes);
app.use('/api/projects', campaignRoutes);

const PORT = process.env.PORT || 4000;

migrate()
  .then(() => app.listen(PORT, () => console.log(`Backend running on port ${PORT}`)))
  .catch(err => { console.error('Startup failed:', err.message); process.exit(1); });
