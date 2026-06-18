const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        project_name TEXT NOT NULL,
        plant_name TEXT,
        application_name TEXT,
        go_live_date DATE,
        status TEXT DEFAULT 'draft',
        default_template_id INT,
        support_champions TEXT,
        notes TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS project_members (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        role TEXT DEFAULT 'viewer',
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS project_users (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        sesa_id TEXT,
        first_name TEXT,
        last_name TEXT,
        mail TEXT,
        function TEXT,
        role TEXT,
        pbom_champion BOOLEAN DEFAULT false,
        boc_admin BOOLEAN DEFAULT false,
        boc_member BOOLEAN DEFAULT false,
        eto_user BOOLEAN DEFAULT false,
        team_manager BOOLEAN DEFAULT false,
        windchill_access BOOLEAN DEFAULT false,
        tlg_group TEXT,
        manager_mail TEXT,
        description TEXT,
        recommended_training TEXT,
        status TEXT DEFAULT 'pending',
        comments TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, sesa_id)
      );

      CREATE TABLE IF NOT EXISTS training_references (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        training_title TEXT NOT NULL,
        training_family TEXT,
        duration_hhmm TEXT,
        duration_decimal NUMERIC(6,2),
        learning_object_code TEXT,
        content_type TEXT,
        learning_url TEXT,
        notes TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS training_profiles (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        profile_name TEXT NOT NULL,
        function_scope TEXT,
        eto_variant BOOLEAN DEFAULT false,
        default_tlg_group TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS profile_training_mappings (
        id SERIAL PRIMARY KEY,
        profile_id INT REFERENCES training_profiles(id) ON DELETE CASCADE,
        training_id INT REFERENCES training_references(id) ON DELETE CASCADE,
        requirement_type TEXT DEFAULT 'mandatory',
        sequence_order INT DEFAULT 0,
        applies_when_eto BOOLEAN,
        applies_when_boc_admin BOOLEAN,
        applies_when_boc_member BOOLEAN,
        applies_when_team_manager BOOLEAN,
        comment TEXT
      );

      CREATE TABLE IF NOT EXISTS templates (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        template_name TEXT NOT NULL,
        source_type TEXT DEFAULT 'default',
        html_content TEXT,
        is_default BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        campaign_name TEXT,
        generation_date TIMESTAMPTZ DEFAULT NOW(),
        generated_by INT REFERENCES users(id),
        template_id INT REFERENCES templates(id),
        user_count INT DEFAULT 0,
        part_count INT DEFAULT 1,
        status TEXT DEFAULT 'drafted',
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS role_matrix (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        function TEXT NOT NULL,
        role TEXT NOT NULL,
        pbom_champion BOOLEAN DEFAULT false,
        boc_admin BOOLEAN DEFAULT false,
        boc_member BOOLEAN DEFAULT false,
        eto_user BOOLEAN DEFAULT false,
        team_manager BOOLEAN DEFAULT false,
        concatenate TEXT NOT NULL,
        pdm_role TEXT,
        tlg_group TEXT,
        recommended_training_id INT,
        complementary_items JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, concatenate)
      );

      CREATE TABLE IF NOT EXISTS training_modules (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content_id TEXT,
        duration_min INT DEFAULT 0,
        link TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, title)
      );

      CREATE TABLE IF NOT EXISTS training_curricula (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content_id TEXT,
        link TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, title)
      );

      CREATE TABLE IF NOT EXISTS curriculum_module_items (
        id SERIAL PRIMARY KEY,
        curriculum_id INT REFERENCES training_curricula(id) ON DELETE CASCADE,
        module_id INT REFERENCES training_modules(id) ON DELETE CASCADE,
        requirement TEXT DEFAULT 'mandatory',
        sequence_order INT DEFAULT 0,
        UNIQUE(curriculum_id, module_id)
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        project_id INT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        link TEXT,
        content_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, title)
      );

      CREATE TABLE IF NOT EXISTS playlist_items (
        id SERIAL PRIMARY KEY,
        playlist_id INT REFERENCES playlists(id) ON DELETE CASCADE,
        curriculum_id INT REFERENCES training_curricula(id) ON DELETE SET NULL,
        module_id INT REFERENCES training_modules(id) ON DELETE SET NULL,
        sequence_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS playlist_curricula (
        id SERIAL PRIMARY KEY,
        playlist_id INT,
        title TEXT NOT NULL,
        content_id TEXT,
        requirement TEXT DEFAULT 'mandatory',
        sequence_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS playlist_modules (
        id SERIAL PRIMARY KEY,
        playlist_id INT,
        curriculum_id INT,
        title TEXT NOT NULL,
        content_id TEXT,
        duration_min INT DEFAULT 0,
        requirement TEXT DEFAULT 'mandatory',
        sequence_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ALTER TABLE guards for columns added to pre-existing tables
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname='playlists_project_id_title_key'
        ) THEN
          ALTER TABLE playlists ADD CONSTRAINT playlists_project_id_title_key UNIQUE (project_id, title);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname='training_profiles_project_name_unique'
        ) THEN
          ALTER TABLE training_profiles ADD CONSTRAINT training_profiles_project_name_unique UNIQUE (project_id, profile_name);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='training_modules' AND column_name='link'
        ) THEN
          ALTER TABLE training_modules ADD COLUMN link TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='training_curricula' AND column_name='link'
        ) THEN
          ALTER TABLE training_curricula ADD COLUMN link TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='role_matrix' AND column_name='recommended_training_id'
        ) THEN
          ALTER TABLE role_matrix ADD COLUMN recommended_training_id INT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='role_matrix' AND column_name='complementary_items'
        ) THEN
          ALTER TABLE role_matrix ADD COLUMN complementary_items JSONB DEFAULT '[]';
        END IF;
      END$$;
    `);

    console.log('Database schema ready');
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = migrate;
