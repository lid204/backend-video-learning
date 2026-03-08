require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối với Aiven MySQL Online
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

pool.getConnection()
  .then(async (connection) => {
    console.log("✅ Đã kết nối thành công với MySQL Aiven Online!");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone VARCHAR(20)
      )
    `);
    console.log("✅ Bảng users đã sẵn sàng!");
    connection.release();
  })
  .catch((err) => console.error("❌ Lỗi kết nối MySQL:", err));

// API Lấy TẤT CẢ
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM users ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy dữ liệu" });
  }
});

// API Lấy 1 USER (Yêu cầu của thầy)
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy user này" });
    res.json(rows[0]); 
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy dữ liệu" });
  }
});

// API Thêm
app.post('/api/users', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const [result] = await pool.query("INSERT INTO users (name, email, phone) VALUES (?, ?, ?)", [name, email, phone]);
    res.json({ id: result.insertId, name, email, phone });
  } catch (err) {
    res.status(500).json({ error: "Lỗi thêm user" });
  }
});

// API Sửa
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;
    await pool.query("UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?", [name, email, phone, id]);
    res.json({ id, name, email, phone });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật" });
  }
});

// API Xóa
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM users WHERE id = ?", [id]);
    res.json({ message: "Xóa thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi xóa user" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend đang chạy tại http://localhost:${PORT}`);
});

// DÒNG NÀY ĐỂ VERCEL CHẠY ĐƯỢC API
module.exports = app;
// Lời chào khi truy cập link gốc
app.get('/', (req, res) => {
  res.send("🎉 Chào mừng đến với Backend API của Nền tảng Video Bài Giảng! Hãy gõ thêm /api/users trên thanh địa chỉ để xem dữ liệu nhé.");
});