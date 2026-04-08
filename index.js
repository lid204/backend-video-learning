require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://frontend-video-learning.vercel.app'
].join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  }
}));
app.use(express.json());

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder: 'video_learning_courses',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
  })
});

const upload = multer({ storage });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
  ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {})
});

const extractYouTubeID = (url = '') => {
  if (!url) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace('/', '').slice(0, 11);
    }
    if (parsed.searchParams.get('v')) {
      return parsed.searchParams.get('v').slice(0, 11);
    }
  } catch {
    // Keep original value below.
  }

  if (url.includes('v=')) return url.split('v=')[1].substring(0, 11);
  if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].substring(0, 11);
  return url;
};

async function ensureColumn(connection, tableName, columnName, definition) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
  if (rows.length === 0) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
  }
}

async function initializeDatabase() {
  const connection = await pool.getConnection();
  try {
    console.log('✅ Đã kết nối MySQL! Đang khởi tạo Database...');

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
        phone VARCHAR(20),
        role ENUM('student', 'teacher', 'admin') DEFAULT 'student',
        avatar_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description LONGTEXT,
        thumbnail_url VARCHAR(255),
        teacher_id INT NOT NULL,
        category_id INT NULL,
        price DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS sections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        order_index INT DEFAULT 1,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS lessons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        section_id INT NULL,
        title VARCHAR(255) NOT NULL,
        video_url VARCHAR(255) NOT NULL,
        duration INT DEFAULT 0,
        order_index INT DEFAULT 1,
        FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id INT NOT NULL,
        progress_percent INT DEFAULT 0,
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        UNIQUE KEY unique_enrollment (user_id, course_id)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id INT NOT NULL,
        rating INT NOT NULL,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS quizzes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lesson_id INT NOT NULL,
        stop_time_seconds INT NOT NULL,
        question TEXT NOT NULL,
        options JSON NOT NULL,
        correct_answer VARCHAR(255) NOT NULL,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_progress (
        user_id INT NOT NULL,
        lesson_id INT NOT NULL,
        watched_seconds INT DEFAULT 0,
        PRIMARY KEY (user_id, lesson_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      );
    `);

    await ensureColumn(connection, 'lessons', 'duration', '`duration` INT DEFAULT 0');
    await ensureColumn(connection, 'lessons', 'order_index', '`order_index` INT DEFAULT 1');
    await ensureColumn(connection, 'lessons', 'section_id', '`section_id` INT NULL');

    const [lessonOrderRows] = await connection.query("SHOW COLUMNS FROM `lessons` LIKE 'lesson_order'");
    if (lessonOrderRows.length > 0) {
      await connection.query('UPDATE lessons SET order_index = COALESCE(order_index, lesson_order, 1)');
    }

    const [legacyCourseColumn] = await connection.query("SHOW COLUMNS FROM `lessons` LIKE 'course_id'");
    if (legacyCourseColumn.length > 0) {
      const [legacyCourses] = await connection.query('SELECT DISTINCT course_id FROM lessons WHERE course_id IS NOT NULL');
      for (const row of legacyCourses) {
        const courseId = row.course_id;
        const [[section]] = await connection.query(
          'SELECT id FROM sections WHERE course_id = ? ORDER BY order_index ASC LIMIT 1',
          [courseId]
        );

        let sectionId = section?.id;
        if (!sectionId) {
          const [insertSection] = await connection.query(
            'INSERT INTO sections (course_id, title, order_index) VALUES (?, ?, 1)',
            [courseId, 'Chương 1']
          );
          sectionId = insertSection.insertId;
        }

        await connection.query(
          'UPDATE lessons SET section_id = ? WHERE course_id = ? AND (section_id IS NULL OR section_id = 0)',
          [sectionId, courseId]
        );
      }
    }

    const [fkRows] = await connection.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'lessons'
        AND COLUMN_NAME = 'section_id'
        AND REFERENCED_TABLE_NAME = 'sections'
    `);
    if (fkRows.length === 0) {
      try {
        await connection.query('ALTER TABLE lessons ADD CONSTRAINT fk_lessons_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE');
      } catch (error) {
        if (!String(error.message).includes('Duplicate')) {
          console.warn('⚠️ Không thể thêm FK section_id cho lessons:', error.message);
        }
      }
    }

    console.log('🛠️ Đang chuẩn bị dữ liệu mẫu...');
    await connection.query("INSERT IGNORE INTO categories (id, name, description) VALUES (1, 'Lập trình Web', 'Danh mục lập trình web')");
    await connection.query("INSERT IGNORE INTO users (id, name, email, password, role) VALUES (1, 'Kiều Zĩ', 'kieu-zi@test.com', '123456', 'student')");
    await connection.query(`
      INSERT INTO courses (id, title, description, teacher_id, category_id, price)
      VALUES (101, 'Lập trình ReactJS cho Gen Z', '<p>Khóa học React cơ bản và thực chiến.</p>', 1, 1, 450000)
      ON DUPLICATE KEY UPDATE title = VALUES(title)
    `);

    const [[section101]] = await connection.query('SELECT id FROM sections WHERE course_id = 101 ORDER BY order_index ASC LIMIT 1');
    let sectionId101 = section101?.id;
    if (!sectionId101) {
      const [insertSection101] = await connection.query(
        "INSERT INTO sections (course_id, title, order_index) VALUES (101, 'Chương 1', 1)"
      );
      sectionId101 = insertSection101.insertId;
    }

    await connection.query(`
      INSERT INTO lessons (id, section_id, title, video_url, duration, order_index)
      VALUES (6, ?, 'Bài 1', 'TPfipn1gUPc', 600, 1)
      ON DUPLICATE KEY UPDATE section_id = VALUES(section_id), title = VALUES(title), video_url = VALUES(video_url), duration = VALUES(duration), order_index = VALUES(order_index)
    `, [sectionId101]);

    await connection.query(`
      INSERT INTO quizzes (lesson_id, stop_time_seconds, question, options, correct_answer)
      SELECT 6, 10, 'React là gì?', JSON_ARRAY('Thư viện UI', 'Database', 'IDE', 'Hệ điều hành'), 'Thư viện UI'
      WHERE NOT EXISTS (
        SELECT 1 FROM quizzes WHERE lesson_id = 6 AND stop_time_seconds = 10
      )
    `);

    console.log('✅ Database đã sẵn sàng.');
  } finally {
    connection.release();
  }
}

initializeDatabase().catch((error) => {
  console.error('❌ Lỗi khởi tạo Database:', error);
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không có file ảnh nào được tải lên!' });
  }
  return res.json({ imageUrl: req.file.path });
});

app.get('/api/users', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi lấy dữ liệu người dùng', details: error.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy user này' });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy dữ liệu người dùng', details: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, email, phone, role = 'student', password = '123456' } = req.body;
    const [result] = await pool.query(
      'INSERT INTO users (name, email, phone, role, password) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone, role, password]
    );
    return res.status(201).json({ id: result.insertId, name, email, phone, role });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi thêm user', details: error.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, email, phone, role } = req.body;
    await pool.query(
      'UPDATE users SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?',
      [name, email, phone, role, req.params.id]
    );
    return res.json({ message: 'Cập nhật thành công' });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi cập nhật user', details: error.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Xóa thành công' });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi xóa user', details: error.message });
  }
});

app.get('/api/categories', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy danh mục', details: error.message });
  }
});

app.get('/api/courses', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, cat.name AS category_name
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      ORDER BY c.id DESC
    `);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy danh sách khóa học', details: error.message });
  }
});

app.get('/api/courses/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, cat.name AS category_name
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy khóa học' });
    }

    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy chi tiết khóa học', details: error.message });
  }
});

app.post('/api/courses', async (req, res) => {
  try {
    const { title, description, thumbnail_url, teacher_id = 1, category_id = null, price = 0 } = req.body;
    const [result] = await pool.query(
      'INSERT INTO courses (title, description, thumbnail_url, teacher_id, category_id, price) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, thumbnail_url, teacher_id, category_id || null, price || 0]
    );
    return res.status(201).json({ message: 'Thêm khóa học thành công!', id: result.insertId });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi thêm khóa học', details: error.message });
  }
});

app.put('/api/courses/:id', async (req, res) => {
  try {
    const { title, description, thumbnail_url, price, category_id = null } = req.body;
    await pool.query(
      'UPDATE courses SET title = ?, description = ?, thumbnail_url = ?, price = ?, category_id = ? WHERE id = ?',
      [title, description, thumbnail_url, price, category_id || null, req.params.id]
    );
    return res.json({ message: 'Cập nhật thành công!' });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi cập nhật khóa học', details: error.message });
  }
});

app.delete('/api/courses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM courses WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Xóa khóa học thành công!' });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi xóa khóa học', details: error.message });
  }
});

app.get('/api/sections/course/:course_id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC, id ASC',
      [req.params.course_id]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy danh sách chương', details: error.message });
  }
});

app.post('/api/sections', async (req, res) => {
  try {
    const { course_id, title, order_index = 1 } = req.body;
    const [result] = await pool.query(
      'INSERT INTO sections (course_id, title, order_index) VALUES (?, ?, ?)',
      [course_id, title, order_index]
    );
    return res.status(201).json({ message: 'Thêm chương thành công!', id: result.insertId });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi thêm chương', details: error.message });
  }
});

app.put('/api/sections/:id', async (req, res) => {
  try {
    const { title, order_index = 1 } = req.body;
    await pool.query(
      'UPDATE sections SET title = ?, order_index = ? WHERE id = ?',
      [title, order_index, req.params.id]
    );
    return res.json({ message: 'Cập nhật chương thành công!' });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi cập nhật chương', details: error.message });
  }
});

app.delete('/api/sections/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sections WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Xóa chương thành công!' });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi xóa chương', details: error.message });
  }
});

app.get('/api/lessons/course/:course_id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        l.id,
        l.section_id,
        l.title,
        l.video_url,
        l.duration,
        l.order_index,
        s.title AS section_title,
        s.order_index AS section_order,
        s.course_id
      FROM lessons l
      INNER JOIN sections s ON l.section_id = s.id
      WHERE s.course_id = ?
      ORDER BY s.order_index ASC, l.order_index ASC, l.id ASC
    `, [req.params.course_id]);

    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy danh sách bài giảng', details: error.message });
  }
});

app.post('/api/lessons', async (req, res) => {
  try {
    const { section_id, title, video_url, duration = 0, order_index = 1 } = req.body;
    const processedUrl = extractYouTubeID(video_url);

    const [result] = await pool.query(
      'INSERT INTO lessons (section_id, title, video_url, duration, order_index) VALUES (?, ?, ?, ?, ?)',
      [section_id, title, processedUrl, duration || 0, order_index || 1]
    );

    return res.status(201).json({
      message: '🎉 Thêm bài giảng thành công!',
      id: result.insertId,
      section_id,
      title,
      video_url: processedUrl
    });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi thêm bài giảng', details: error.message });
  }
});

app.put('/api/lessons/:id', async (req, res) => {
  try {
    const { section_id, title, video_url, duration = 0, order_index = 1 } = req.body;
    const processedUrl = extractYouTubeID(video_url);

    await pool.query(
      'UPDATE lessons SET section_id = ?, title = ?, video_url = ?, duration = ?, order_index = ? WHERE id = ?',
      [section_id, title, processedUrl, duration || 0, order_index || 1, req.params.id]
    );

    return res.json({ message: '✅ Cập nhật bài giảng thành công!', video_id_saved: processedUrl });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi cập nhật bài giảng', details: error.message });
  }
});

app.delete('/api/lessons/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM lessons WHERE id = ?', [req.params.id]);
    return res.json({ message: '🗑️ Đã xóa bài giảng thành công!' });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi xóa bài giảng', details: error.message });
  }
});

app.get('/api/reviews/:course_id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name, u.avatar_url
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.course_id = ?
       ORDER BY r.created_at DESC`,
      [req.params.course_id]
    );

    const [avgResult] = await pool.query(
      'SELECT AVG(rating) AS avg_rating, COUNT(*) AS total_reviews FROM reviews WHERE course_id = ?',
      [req.params.course_id]
    );

    return res.json({
      reviews: rows,
      avg_rating: Number(parseFloat(avgResult[0]?.avg_rating || 0).toFixed(1)),
      total_reviews: avgResult[0]?.total_reviews || 0
    });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy danh sách đánh giá', details: error.message });
  }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const { user_id, course_id, rating, comment } = req.body;

    if (!user_id || !course_id || !rating) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (user_id, course_id, rating)' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating phải nằm trong khoảng 1-5 sao' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM reviews WHERE user_id = ? AND course_id = ?',
      [user_id, course_id]
    );

    if (existing.length > 0) {
      await pool.query(
        'UPDATE reviews SET rating = ?, comment = ? WHERE user_id = ? AND course_id = ?',
        [rating, comment || '', user_id, course_id]
      );
      return res.json({ message: '✅ Đã cập nhật đánh giá của bạn!' });
    }

    const [result] = await pool.query(
      'INSERT INTO reviews (user_id, course_id, rating, comment) VALUES (?, ?, ?, ?)',
      [user_id, course_id, rating, comment || '']
    );

    return res.status(201).json({ message: '🎉 Cảm ơn bạn đã đánh giá!', id: result.insertId });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi gửi đánh giá', details: error.message });
  }
});

app.get('/api/lessons/:id/quizzes', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, lesson_id, stop_time_seconds, question, options, correct_answer FROM quizzes WHERE lesson_id = ? ORDER BY stop_time_seconds ASC, id ASC',
      [req.params.id]
    );

    const quizzes = rows.map((item) => ({
      ...item,
      options: Array.isArray(item.options) ? item.options : JSON.parse(item.options || '[]')
    }));

    return res.status(200).json(quizzes);
  } catch (error) {
    console.error('Lỗi khi lấy quizzes:', error);
    return res.status(500).json({ message: 'Lỗi server', details: error.message });
  }
});

app.post('/api/progress', async (req, res) => {
  try {
    const { user_id, lesson_id, watched_seconds } = req.body;

    if (!user_id || !lesson_id || watched_seconds === undefined) {
      return res.status(400).json({ message: 'Thiếu dữ liệu đầu vào' });
    }

    const safeUserId = Math.floor(Number(user_id));
    const safeLessonId = Math.floor(Number(lesson_id));
    const safeSeconds = Math.max(0, Math.floor(Number(watched_seconds)));

    if (!Number.isInteger(safeUserId) || safeUserId <= 0 || !Number.isInteger(safeLessonId) || safeLessonId <= 0) {
      return res.status(400).json({ message: 'user_id hoặc lesson_id không hợp lệ' });
    }

    await pool.query(
      `INSERT INTO user_progress (user_id, lesson_id, watched_seconds)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE watched_seconds = GREATEST(watched_seconds, ?)`,
      [safeUserId, safeLessonId, safeSeconds, safeSeconds]
    );

    return res.status(200).json({ message: 'Đã lưu tiến độ', watched_seconds: safeSeconds });
  } catch (error) {
    console.error('Lỗi khi lưu tiến độ:', error);
    return res.status(500).json({ message: 'Lỗi server', details: error.message });
  }
});

app.get('/api/progress', async (req, res) => {
  try {
    const { user_id, lesson_id } = req.query;
    if (!user_id || !lesson_id) {
      return res.status(400).json({ message: 'Thiếu user_id hoặc lesson_id' });
    }

    const safeUserId = Math.floor(Number(user_id));
    const safeLessonId = Math.floor(Number(lesson_id));

    if (!Number.isInteger(safeUserId) || safeUserId <= 0 || !Number.isInteger(safeLessonId) || safeLessonId <= 0) {
      return res.status(400).json({ message: 'user_id hoặc lesson_id không hợp lệ' });
    }

    const [rows] = await pool.query(
      'SELECT watched_seconds FROM user_progress WHERE user_id = ? AND lesson_id = ?',
      [safeUserId, safeLessonId]
    );

    return res.json({ watched_seconds: rows[0]?.watched_seconds || 0 });
  } catch (error) {
    return res.status(500).json({ message: 'Lỗi server', details: error.message });
  }
});

app.post('/api/enrollments', async (req, res) => {
  try {
    const { user_id, course_id } = req.body;
    const [result] = await pool.query(
      'INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)',
      [user_id, course_id]
    );
    return res.status(201).json({ message: '🎉 Cảm ơn bạn đã ghi danh!', id: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Đã đăng ký khóa này rồi!' });
    }
    return res.status(500).json({ error: 'Lỗi hệ thống', details: error.message });
  }
});

app.get('/api/my-courses/:user_id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT c.* FROM courses c JOIN enrollments e ON c.id = e.course_id WHERE e.user_id = ?',
      [req.params.user_id]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi lấy khóa học của tôi', details: error.message });
  }
});

app.get('/api/check-db', async (_req, res) => {
  try {
    const [tables] = await pool.query('SHOW TABLES');
    const [lessonColumns] = await pool.query('DESCRIBE lessons');
    const [sectionColumns] = await pool.query('DESCRIBE sections');
    const [userColumns] = await pool.query('DESCRIBE users');
    return res.json({
      message: 'Trạng thái Database hiện tại',
      total_tables: tables.length,
      tables,
      users_structure: userColumns,
      sections_structure: sectionColumns,
      lessons_structure: lessonColumns
    });
  } catch (error) {
    return res.status(500).json({ error: 'Lỗi soi Database', details: error.message });
  }
});

app.get('/', (_req, res) => {
  res.send('🎉 Chào mừng đến với Backend API của Nền tảng Video Bài Giảng!');
}); 

const PORT = Number(process.env.PORT || 5000);
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server Backend đang chạy tại cổng ${PORT}`);
  });
}

module.exports = app;
