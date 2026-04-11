require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();

/* =============================
   CORS
============================= */
const allowedOrigins = (process.env.CORS_ORIGINS || [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://frontend-video-learning-lid204s-projects.vercel.app',
  'https://frontend-video-learning.vercel.app'
].join(','))
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

app.use(express.json());

/* =============================
   Cloudinary Upload
============================= */
const hasCloudinary =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (hasCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

let upload = null;

if (hasCloudinary) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'video_learning_courses',
      allowedFormats: ['jpg', 'png', 'jpeg', 'webp']
    }
  });

  upload = multer({ storage });
}

app.post('/api/upload', (req, res, next) => {
  if (!upload) {
    return res.status(500).json({
      error: 'Cloudinary chưa cấu hình. Vui lòng kiểm tra biến môi trường.'
    });
  }
  return upload.single('image')(req, res, next);
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không có file ảnh nào được tải lên.' });
  }
  res.json({ imageUrl: req.file.path });
});

/* =============================
   Helpers
============================= */
function extractYouTubeID(url) {
  if (!url) return '';

  try {
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];

    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];

    const embedMatch = url.match(/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];

    return url;
  } catch {
    return url;
  }
}

function buildDbConfig() {
  const useSSL = String(process.env.DB_SSL || '').toLowerCase() === 'true';

  const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'video_learning',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true
  };

  if (useSSL) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

const pool = mysql.createPool(buildDbConfig());

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );
  return rows[0]?.total > 0;
}

async function ensureColumn(connection, tableName, columnName, definitionSql) {
  const exists = await columnExists(connection, tableName, columnName);
  if (!exists) {
    await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
    console.log(`✅ Added column ${tableName}.${columnName}`);
  }
}

async function ensureDatabase() {
  const connection = await pool.getConnection();

  try {
    console.log('🔌 Đang kiểm tra và khởi tạo database...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL DEFAULT '123456',
        role ENUM('student', 'teacher', 'admin') DEFAULT 'student'
      );

      CREATE TABLE IF NOT EXISTS courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        thumbnail_url VARCHAR(255),
        teacher_id INT NULL,
        category_id INT NULL,
        price DECIMAL(10,2) DEFAULT 0.00
      );

      CREATE TABLE IF NOT EXISTS sections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        order_index INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS lessons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NULL,
        section_id INT NULL,
        title VARCHAR(255) NOT NULL,
        video_url VARCHAR(255) NOT NULL,
        duration INT DEFAULT 0,
        order_index INT DEFAULT 1,
        lesson_order INT DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id INT NOT NULL,
        progress_percent INT DEFAULT 0,
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_course (user_id, course_id)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id INT NOT NULL,
        rating INT NOT NULL,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await ensureColumn(connection, 'users', 'phone', 'VARCHAR(20) NULL');
    await ensureColumn(connection, 'users', 'avatar_url', 'VARCHAR(255) NULL');
    await ensureColumn(connection, 'users', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    await ensureColumn(connection, 'courses', 'teacher_id', 'INT NULL');
    await ensureColumn(connection, 'courses', 'category_id', 'INT NULL');
    await ensureColumn(connection, 'courses', 'price', 'DECIMAL(10,2) DEFAULT 0.00');
    await ensureColumn(connection, 'courses', 'thumbnail_url', 'VARCHAR(255) NULL');
    await ensureColumn(connection, 'courses', 'description', 'TEXT NULL');

    await ensureColumn(connection, 'sections', 'course_id', 'INT NOT NULL');
    await ensureColumn(connection, 'sections', 'title', 'VARCHAR(255) NOT NULL');
    await ensureColumn(connection, 'sections', 'order_index', 'INT DEFAULT 0');

    await ensureColumn(connection, 'lessons', 'course_id', 'INT NULL');
    await ensureColumn(connection, 'lessons', 'section_id', 'INT NULL');
    await ensureColumn(connection, 'lessons', 'duration', 'INT DEFAULT 0');
    await ensureColumn(connection, 'lessons', 'order_index', 'INT DEFAULT 1');
    await ensureColumn(connection, 'lessons', 'lesson_order', 'INT DEFAULT 1');

    await ensureColumn(connection, 'enrollments', 'progress_percent', 'INT DEFAULT 0');
    await ensureColumn(connection, 'enrollments', 'enrolled_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    await ensureColumn(connection, 'reviews', 'comment', 'TEXT NULL');
    await ensureColumn(connection, 'reviews', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    // Seed tối thiểu
    await connection.query(`
      INSERT IGNORE INTO users (id, name, email, password, role)
      VALUES (1, 'Admin Demo', 'admin@test.com', '123456', 'admin')
    `);

    await connection.query(`
      INSERT IGNORE INTO categories (id, name, description)
      VALUES (1, 'Chưa phân loại', 'Danh mục mặc định')
    `);

    console.log('✅ Database đã sẵn sàng.');
  } finally {
    connection.release();
  }
}

/* =============================
   Basic Routes
============================= */
app.get('/', (_req, res) => {
  res.send('🎉 Backend Video Learning đang hoạt động.');
});

app.get('/api/check-db', async (_req, res) => {
  try {
    const [tables] = await pool.query('SHOW TABLES');
    const [usersDesc] = await pool.query('DESCRIBE users');
    const [coursesDesc] = await pool.query('DESCRIBE courses');
    const [sectionsDesc] = await pool.query('DESCRIBE sections');
    const [lessonsDesc] = await pool.query('DESCRIBE lessons');

    res.json({
      ok: true,
      total_tables: tables.length,
      tables,
      structures: {
        users: usersDesc,
        courses: coursesDesc,
        sections: sectionsDesc,
        lessons: lessonsDesc
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi kiểm tra database', details: err.message });
  }
});

/* =============================
   Users
============================= */
app.get('/api/users', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy dữ liệu người dùng', details: err.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Không tìm thấy user này' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy dữ liệu người dùng', details: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const {
      name,
      email,
      phone = null,
      role = 'student',
      password = '123456'
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Thiếu name hoặc email' });
    }

    const [result] = await pool.query(
      'INSERT INTO users (name, email, phone, role, password) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone, role, password]
    );

    res.status(201).json({
      id: result.insertId,
      name,
      email,
      phone,
      role
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thêm user', details: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, email, phone = null, role = 'student' } = req.body;

    await pool.query(
      'UPDATE users SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?',
      [name, email, phone, role, req.params.id]
    );

    res.json({ message: 'Cập nhật thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật user', details: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'Xóa thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xóa user', details: err.message });
  }
});

/* =============================
   Categories
============================= */
app.get('/api/categories', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy danh mục', details: err.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { name, description = null } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Tên danh mục không hợp lệ' });
    }

    const [result] = await pool.query(
      'INSERT INTO categories (name, description) VALUES (?, ?)',
      [name, description]
    );

    res.status(201).json({
      id: result.insertId,
      name,
      description
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thêm danh mục', details: err.message });
  }
});

/* =============================
   Courses
============================= */
app.get('/api/courses', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        c.*,
        cat.name AS category_name,
        u.name AS teacher_name
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      LEFT JOIN users u ON c.teacher_id = u.id
      ORDER BY c.id DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy danh sách khóa học', details: err.message });
  }
});

app.get('/api/courses/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        c.*,
        cat.name AS category_name,
        u.name AS teacher_name
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      LEFT JOIN users u ON c.teacher_id = u.id
      WHERE c.id = ?
    `, [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Không tìm thấy khóa học này' });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy chi tiết khóa học', details: err.message });
  }
});

app.post('/api/courses', async (req, res) => {
  try {
    const {
      title,
      description = '',
      thumbnail_url = '',
      teacher_id = 1,
      category_id = null,
      price = 0
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Thiếu tiêu đề khóa học' });
    }

    const [result] = await pool.query(
      `
        INSERT INTO courses (title, description, thumbnail_url, teacher_id, category_id, price)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [title, description, thumbnail_url, teacher_id, category_id, price]
    );

    res.status(201).json({
      message: 'Thêm khóa học thành công',
      id: result.insertId
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thêm khóa học', details: err.message });
  }
});

app.put('/api/courses/:id', async (req, res) => {
  try {
    const {
      title,
      description = '',
      thumbnail_url = '',
      price = 0,
      category_id = null,
      teacher_id = 1
    } = req.body;

    await pool.query(
      `
        UPDATE courses
        SET title = ?, description = ?, thumbnail_url = ?, price = ?, category_id = ?, teacher_id = ?
        WHERE id = ?
      `,
      [title, description, thumbnail_url, price, category_id, teacher_id, req.params.id]
    );

    res.json({ message: 'Cập nhật khóa học thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật khóa học', details: err.message });
  }
});

app.delete('/api/courses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ message: 'Xóa khóa học thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xóa khóa học', details: err.message });
  }
});

/* =============================
   Enrollments
============================= */
app.post('/api/enrollments', async (req, res) => {
  try {
    const { user_id, course_id } = req.body;

    if (!user_id || !course_id) {
      return res.status(400).json({ error: 'Thiếu user_id hoặc course_id' });
    }

    const [result] = await pool.query(
      'INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)',
      [user_id, course_id]
    );

    res.status(201).json({
      message: 'Đăng ký khóa học thành công',
      id: result.insertId
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Bạn đã đăng ký khóa học này rồi' });
    }
    res.status(500).json({ error: 'Lỗi đăng ký khóa học', details: err.message });
  }
});
/* =============================
   Checkout (Thanh toán & Mở khóa)
============================= */
app.post('/api/checkout', async (req, res) => {
  try {
    const { user_id, cartItems } = req.body;

    if (!user_id || !cartItems || !cartItems.length) {
      return res.status(400).json({ error: 'Thiếu thông tin người dùng hoặc giỏ hàng trống!' });
    }

    // Lặp qua từng khóa học trong giỏ và thêm vào bảng enrollments
    for (let item of cartItems) {
      try {
        // Dùng INSERT IGNORE để nếu lỡ họ mua rồi thì hệ thống không bị lỗi
        await pool.query(
          'INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)',
          [user_id, item.id]
        );
      } catch (e) {
        console.log(`Lỗi khi mở khóa khóa học ${item.id}:`, e.message);
      }
    }

    res.status(200).json({ message: 'Thanh toán thành công! Khóa học đã được mở.' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi hệ thống khi thanh toán', details: err.message });
  }
});
// Alias nếu frontend cũ gọi route khác
app.post('/api/enroll', async (req, res) => {
  req.url = '/api/enrollments';
  app._router.handle(req, res, () => {});
});

app.get('/api/my-courses/:user_id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        c.*,
        e.progress_percent,
        e.enrolled_at
      FROM courses c
      JOIN enrollments e ON c.id = e.course_id
      WHERE e.user_id = ?
      ORDER BY e.enrolled_at DESC
    `, [req.params.user_id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy khóa học của tôi', details: err.message });
  }
});

/* =============================
   Sections + Curriculum
============================= */
app.get('/api/courses/:course_id/curriculum', async (req, res) => {
  try {
    const { course_id } = req.params;

    const [sections] = await pool.query(
      'SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC, id ASC',
      [course_id]
    );

    if (!sections.length) {
      // fallback cho dữ liệu cũ chỉ có lessons theo course_id
      const [lessonsOnly] = await pool.query(
        `
          SELECT *
          FROM lessons
          WHERE course_id = ?
          ORDER BY COALESCE(order_index, lesson_order, 1) ASC, id ASC
        `,
        [course_id]
      );

      return res.json([{
        id: 0,
        course_id: Number(course_id),
        title: 'Nội dung khóa học',
        order_index: 1,
        lessons: lessonsOnly
      }]);
    }

    const curriculum = await Promise.all(
      sections.map(async (section) => {
        let [lessons] = await pool.query(
          `
            SELECT *
            FROM lessons
            WHERE section_id = ?
            ORDER BY COALESCE(order_index, lesson_order, 1) ASC, id ASC
          `,
          [section.id]
        );

        if (!lessons.length) {
          [lessons] = await pool.query(
            `
              SELECT *
              FROM lessons
              WHERE course_id = ?
              ORDER BY COALESCE(order_index, lesson_order, 1) ASC, id ASC
            `,
            [course_id]
          );
        }

        return { ...section, lessons };
      })
    );

    res.json(curriculum);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy curriculum', details: err.message });
  }
});

app.post('/api/sections', async (req, res) => {
  try {
    const { course_id, title, order_index = 0 } = req.body;

    if (!course_id || !title) {
      return res.status(400).json({ error: 'Thiếu course_id hoặc title' });
    }

    const [result] = await pool.query(
      'INSERT INTO sections (course_id, title, order_index) VALUES (?, ?, ?)',
      [course_id, title, order_index]
    );

    res.status(201).json({
      message: 'Thêm chương thành công',
      id: result.insertId
    });
  } catch (err) {
    console.error('POST /api/sections error:', err);
    res.status(500).json({ error: 'Lỗi thêm chương', details: err.message });
  }
});

/* =============================
   Lessons
============================= */
app.get('/api/lessons/course/:course_id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT *
        FROM lessons
        WHERE course_id = ?
        ORDER BY COALESCE(order_index, lesson_order, 1) ASC, id ASC
      `,
      [req.params.course_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy danh sách bài giảng', details: err.message });
  }
});

app.post('/api/lessons', async (req, res) => {
  try {
    let {
      course_id = null,
      section_id = null,
      title,
      video_url,
      duration = 0,
      order_index = 1,
      lesson_order = null
    } = req.body;

    if (!title || !video_url) {
      return res.status(400).json({ error: 'Thiếu title hoặc video_url' });
    }

    if (!course_id && section_id) {
      const [sectionRows] = await pool.query(
        'SELECT course_id FROM sections WHERE id = ?',
        [section_id]
      );
      if (sectionRows.length) {
        course_id = sectionRows[0].course_id;
      }
    }

    if (!course_id) {
      return res.status(400).json({ error: 'Thiếu course_id hoặc section_id hợp lệ' });
    }

    const processedUrl = extractYouTubeID(video_url);
    const finalLessonOrder = lesson_order ?? order_index;

    const [result] = await pool.query(
      `
        INSERT INTO lessons (course_id, section_id, title, video_url, duration, order_index, lesson_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [course_id, section_id, title, processedUrl, duration, order_index, finalLessonOrder]
    );

    res.status(201).json({
      message: 'Thêm bài giảng thành công',
      id: result.insertId,
      course_id,
      section_id,
      title,
      video_url: processedUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thêm bài giảng', details: err.message });
  }
});

app.put('/api/lessons/:id', async (req, res) => {
  try {
    const {
      title,
      video_url,
      duration = 0,
      order_index = 1,
      lesson_order = null,
      section_id = null,
      course_id = null
    } = req.body;

    const processedUrl = extractYouTubeID(video_url);
    const finalLessonOrder = lesson_order ?? order_index;

    await pool.query(
      `
        UPDATE lessons
        SET title = ?, video_url = ?, duration = ?, order_index = ?, lesson_order = ?, section_id = COALESCE(?, section_id), course_id = COALESCE(?, course_id)
        WHERE id = ?
      `,
      [title, processedUrl, duration, order_index, finalLessonOrder, section_id, course_id, req.params.id]
    );

    res.json({
      message: 'Cập nhật bài giảng thành công',
      video_id_saved: processedUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật bài giảng', details: err.message });
  }
});

app.delete('/api/lessons/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM lessons WHERE id = ?', [req.params.id]);
    res.json({ message: 'Xóa bài giảng thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xóa bài giảng', details: err.message });
  }
});

app.get('/api/lessons/:id/quizzes', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM quizzes WHERE lesson_id = ? ORDER BY stop_time_seconds ASC, id ASC',
      [req.params.id]
    );

    const normalized = rows.map((q) => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
    }));

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy quiz', details: err.message });
  }
});

/*Hiện cây hỏi*/

app.post('/api/progress', async (req, res) => {
  try {
    const { user_id, lesson_id, watched_seconds } = req.body;

    if (!user_id || !lesson_id) {
      return res.status(400).json({ error: 'Thiếu user_id hoặc lesson_id' });
    }

    await pool.query(
      `
      INSERT INTO progress (user_id, lesson_id, watched_seconds)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE watched_seconds = VALUES(watched_seconds)
      `,
      [user_id, lesson_id, watched_seconds || 0]
    );

    res.json({ message: 'Lưu tiến độ thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lưu tiến độ', details: err.message });
  }
});

/**Lưu tiến độ */
app.get('/api/progress', async (req, res) => {
  try {
    const { user_id, lesson_id } = req.query;

    const [rows] = await pool.query(
      'SELECT * FROM progress WHERE user_id = ? AND lesson_id = ? LIMIT 1',
      [user_id, lesson_id]
    );

    res.json(rows[0] || { watched_seconds: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy tiến độ', details: err.message });
  }
});
/* =============================
   Reviews
============================= */
app.get('/api/reviews/:course_id', async (req, res) => {
  try {
    const { course_id } = req.params;

    const [reviews] = await pool.query(
      `
        SELECT
          r.id,
          r.rating,
          r.comment,
          r.created_at,
          u.name AS user_name,
          u.avatar_url
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.course_id = ?
        ORDER BY r.created_at DESC
      `,
      [course_id]
    );

    const [avgResult] = await pool.query(
      `
        SELECT AVG(rating) AS avg_rating, COUNT(*) AS total_reviews
        FROM reviews
        WHERE course_id = ?
      `,
      [course_id]
    );

    res.json({
      reviews,
      avg_rating: parseFloat(avgResult[0]?.avg_rating || 0).toFixed(1),
      total_reviews: avgResult[0]?.total_reviews || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy đánh giá', details: err.message });
  }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const { user_id, course_id, rating, comment = '' } = req.body;

    if (!user_id || !course_id || !rating) {
      return res.status(400).json({ error: 'Thiếu user_id, course_id hoặc rating' });
    }

    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ error: 'Rating phải từ 1 đến 5' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM reviews WHERE user_id = ? AND course_id = ?',
      [user_id, course_id]
    );

    if (existing.length) {
      await pool.query(
        'UPDATE reviews SET rating = ?, comment = ? WHERE user_id = ? AND course_id = ?',
        [rating, comment, user_id, course_id]
      );
      return res.json({ message: 'Cập nhật đánh giá thành công' });
    }

    const [result] = await pool.query(
      'INSERT INTO reviews (user_id, course_id, rating, comment) VALUES (?, ?, ?, ?)',
      [user_id, course_id, rating, comment]
    );

    res.status(201).json({
      message: 'Gửi đánh giá thành công',
      id: result.insertId
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi gửi đánh giá', details: err.message });
  }
});

/* =============================
   Stats
============================= */
app.get('/api/stats/revenue', async (req, res) => {
  try {
    const { period } = req.query;
    let query = '';

    if (period === 'daily') {
      query = `
        SELECT
          DATE(e.enrolled_at) AS label,
          COALESCE(SUM(c.price), 0) AS revenue,
          COUNT(e.id) AS orders
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE e.enrolled_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(e.enrolled_at)
        ORDER BY label ASC
      `;
    } else {
      query = `
        SELECT
          DATE_FORMAT(e.enrolled_at, '%Y-%m') AS label,
          COALESCE(SUM(c.price), 0) AS revenue,
          COUNT(e.id) AS orders
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        GROUP BY DATE_FORMAT(e.enrolled_at, '%Y-%m')
        ORDER BY label ASC
        LIMIT 12
      `;
    }

    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thống kê doanh thu', details: err.message });
  }
});

app.get('/api/stats/top-courses', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        c.id,
        c.title,
        c.thumbnail_url,
        c.price,
        COUNT(e.id) AS student_count,
        COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM courses c
      LEFT JOIN enrollments e ON c.id = e.course_id
      LEFT JOIN reviews r ON c.id = r.course_id
      GROUP BY c.id, c.title, c.thumbnail_url, c.price
      ORDER BY student_count DESC, c.id DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy top khóa học', details: err.message });
  }
});

app.get('/api/stats/completion-rate', async (_req, res) => {
  try {
    const [overall] = await pool.query(`
      SELECT
        COALESCE(AVG(progress_percent), 0) AS avg_completion,
        COUNT(CASE WHEN progress_percent = 100 THEN 1 END) AS completed_count,
        COUNT(CASE WHEN progress_percent > 0 AND progress_percent < 100 THEN 1 END) AS in_progress_count,
        COUNT(CASE WHEN progress_percent = 0 THEN 1 END) AS not_started_count,
        COUNT(*) AS total_enrollments
      FROM enrollments
    `);

    const [byCourse] = await pool.query(`
      SELECT
        c.title AS course_title,
        COALESCE(AVG(e.progress_percent), 0) AS avg_completion,
        COUNT(e.id) AS total_students
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      GROUP BY c.id, c.title
      ORDER BY avg_completion DESC
      LIMIT 5
    `);

    res.json({
      overall: overall[0],
      by_course: byCourse
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thống kê hoàn thành', details: err.message });
  }
});

app.get('/api/stats/overview', async (_req, res) => {
  try {
    const [newUsers] = await pool.query(`
      SELECT COUNT(*) AS new_users_this_month
      FROM users
      WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
    `);

    const [totalUsers] = await pool.query('SELECT COUNT(*) AS total FROM users');
    const [totalCourses] = await pool.query('SELECT COUNT(*) AS total FROM courses');
    const [totalEnrollments] = await pool.query('SELECT COUNT(*) AS total FROM enrollments');

    const [totalRevenue] = await pool.query(`
      SELECT COALESCE(SUM(c.price), 0) AS total_revenue
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
    `);

    const [revenueThisMonth] = await pool.query(`
      SELECT COALESCE(SUM(c.price), 0) AS revenue_this_month
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE MONTH(e.enrolled_at) = MONTH(NOW()) AND YEAR(e.enrolled_at) = YEAR(NOW())
    `);

    res.json({
      new_users_this_month: newUsers[0]?.new_users_this_month || 0,
      total_users: totalUsers[0]?.total || 0,
      total_courses: totalCourses[0]?.total || 0,
      total_enrollments: totalEnrollments[0]?.total || 0,
      total_revenue: totalRevenue[0]?.total_revenue || 0,
      revenue_this_month: revenueThisMonth[0]?.revenue_this_month || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thống kê tổng quan', details: err.message });
  }
});

/* =============================
   Global Error Handler
============================= */
app.use((err, _req, res, _next) => {
  console.error('❌ Global error:', err);
  res.status(500).json({
    error: 'Lỗi hệ thống',
    details: err.message
  });
});

/* =============================
   Start Server
============================= */
const PORT = Number(process.env.PORT || 5000);

ensureDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server Backend đang chạy tại cổng ${PORT}`);
      console.log(`🌐 Allowed origins: ${allowedOrigins.join(', ')}`);
    });
  })
  .catch((err) => {
    console.error('❌ Không thể khởi tạo database:', err);
    process.exit(1);
  });

module.exports = app;
