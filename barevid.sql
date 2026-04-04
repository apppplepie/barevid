/*
 Navicat Premium Data Transfer

 Source Server         : mysql
 Source Server Type    : MySQL
 Source Server Version : 80044 (8.0.44)
 Source Host           : localhost:3306
 Source Schema         : barevid

 Target Server Type    : MySQL
 Target Server Version : 80044 (8.0.44)
 File Encoding         : 65001

 Date: 03/04/2026 18:09:10
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for auth_sessions
-- ----------------------------
DROP TABLE IF EXISTS `auth_sessions`;
CREATE TABLE `auth_sessions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_auth_sessions_token_hash`(`token_hash` ASC) USING BTREE,
  INDEX `ix_auth_sessions_user_id`(`user_id` ASC) USING BTREE,
  CONSTRAINT `auth_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 8 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for node_contents
-- ----------------------------
DROP TABLE IF EXISTS `node_contents`;
CREATE TABLE `node_contents`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `node_id` int NOT NULL,
  `narration_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `duration_ms` int NULL DEFAULT NULL,
  `audio_sequence` int NOT NULL,
  `audio_asset_id` int NULL DEFAULT NULL,
  `image_asset_id` int NULL DEFAULT NULL,
  `background_asset_id` int NULL DEFAULT NULL,
  `scene_style_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `enter_transition` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `exit_transition` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `page_code` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `page_deck_status` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `page_deck_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `narration_brief` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `narration_alignment_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_node_contents_node_id`(`node_id` ASC) USING BTREE,
  CONSTRAINT `node_contents_ibfk_1` FOREIGN KEY (`node_id`) REFERENCES `outline_nodes` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 7 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for outline_nodes
-- ----------------------------
DROP TABLE IF EXISTS `outline_nodes`;
CREATE TABLE `outline_nodes`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `parent_id` int NULL DEFAULT NULL,
  `sort_order` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `node_kind` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subtree_has_content` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_outline_nodes_parent_id`(`parent_id` ASC) USING BTREE,
  INDEX `ix_outline_nodes_project_id`(`project_id` ASC) USING BTREE,
  CONSTRAINT `outline_nodes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `outline_nodes_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `outline_nodes` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 7 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for project_styles
-- ----------------------------
DROP TABLE IF EXISTS `project_styles`;
CREATE TABLE `project_styles`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `origin_project_id` int NULL DEFAULT NULL COMMENT '最初生成该 style 的 project ID',
  `style_base_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `version` int NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `style_preset` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'aurora_glass',
  `user_style_hint` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `style_prompt_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `style_data_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_project_styles_project_id`(`origin_project_id` ASC) USING BTREE,
  INDEX `ix_project_styles_origin_project_id`(`origin_project_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for projects
-- ----------------------------
DROP TABLE IF EXISTS `projects`;
CREATE TABLE `projects`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `input_prompt` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `user_id` int NULL DEFAULT NULL,
  `owner_user_id` int NULL DEFAULT NULL,
  `is_shared` tinyint(1) NOT NULL DEFAULT 0,
  `aspect_ratio` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '16:9' COMMENT '画布比例',
  `deck_width` int NULL DEFAULT 1920 COMMENT '画布宽度(px)',
  `deck_height` int NULL DEFAULT 1080 COMMENT '画布高度(px)',
  `deck_page_size` int NULL DEFAULT 10 COMMENT '分页大小',
  `theme` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'default' COMMENT '主题',
  `language` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'zh' COMMENT '语言',
  `total_slides` int NULL DEFAULT 0 COMMENT '幻灯片数量',
  `style_id` int NULL DEFAULT NULL COMMENT '当前主题',
  `target_narration_seconds` int NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_projects_user_id`(`user_id` ASC) USING BTREE,
  INDEX `ix_projects_owner_user_id`(`owner_user_id` ASC) USING BTREE,
  INDEX `fk_projects_style`(`style_id` ASC) USING BTREE,
  CONSTRAINT `fk_projects_style` FOREIGN KEY (`style_id`) REFERENCES `project_styles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `projects_ibfk_2` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_users_username`(`username` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for video_export_jobs
-- ----------------------------
DROP TABLE IF EXISTS `video_export_jobs`;
CREATE TABLE `video_export_jobs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `status` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `width` int NOT NULL DEFAULT 1920,
  `height` int NOT NULL DEFAULT 1080,
  `request_authorization` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `worker_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_video_export_jobs_project_id`(`project_id` ASC) USING BTREE,
  CONSTRAINT `video_export_jobs_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 13 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_ai_decisions
-- ----------------------------
DROP TABLE IF EXISTS `workflow_ai_decisions`;
CREATE TABLE `workflow_ai_decisions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `candidate_actions_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `context_snapshot_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `model_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `prompt_version` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `decision_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `confidence` decimal(5, 4) NULL DEFAULT NULL,
  `status` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'suggested',
  `created_at` datetime NOT NULL,
  `decided_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_workflow_ai_decisions_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  INDEX `ix_workflow_ai_decisions_step_key`(`step_key` ASC) USING BTREE,
  INDEX `ix_workflow_ai_decisions_status`(`status` ASC) USING BTREE,
  CONSTRAINT `workflow_ai_decisions_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_artifacts
-- ----------------------------
DROP TABLE IF EXISTS `workflow_artifacts`;
CREATE TABLE `workflow_artifacts`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_attempt_id` int NULL DEFAULT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `artifact_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `artifact_role` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'output',
  `file_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `size_bytes` bigint NULL DEFAULT NULL,
  `sha256` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `storage_key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `meta_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_workflow_artifacts_artifact_type`(`artifact_type` ASC) USING BTREE,
  INDEX `ix_workflow_artifacts_step_key`(`step_key` ASC) USING BTREE,
  INDEX `ix_workflow_artifacts_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  INDEX `ix_workflow_artifacts_step_attempt_id`(`step_attempt_id` ASC) USING BTREE,
  CONSTRAINT `workflow_artifacts_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `workflow_artifacts_ibfk_2` FOREIGN KEY (`step_attempt_id`) REFERENCES `workflow_step_attempts` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 19 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_definitions
-- ----------------------------
DROP TABLE IF EXISTS `workflow_definitions`;
CREATE TABLE `workflow_definitions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `definition_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `dag_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uq_workflow_definitions_key_version`(`definition_key` ASC, `version` ASC) USING BTREE,
  INDEX `ix_workflow_definitions_is_active`(`is_active` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_events
-- ----------------------------
DROP TABLE IF EXISTS `workflow_events`;
CREATE TABLE `workflow_events`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `event_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system',
  `actor_id` int NULL DEFAULT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_workflow_events_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  INDEX `ix_workflow_events_step_key`(`step_key` ASC) USING BTREE,
  INDEX `ix_workflow_events_event_type`(`event_type` ASC) USING BTREE,
  CONSTRAINT `workflow_events_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_export_runs
-- ----------------------------
DROP TABLE IF EXISTS `workflow_export_runs`;
CREATE TABLE `workflow_export_runs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_attempt_id` int NULL DEFAULT NULL,
  `status` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `export_format` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `output_file_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_workflow_export_runs_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  INDEX `ix_workflow_export_runs_step_attempt_id`(`step_attempt_id` ASC) USING BTREE,
  CONSTRAINT `workflow_export_runs_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `workflow_export_runs_ibfk_2` FOREIGN KEY (`step_attempt_id`) REFERENCES `workflow_step_attempts` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_runs
-- ----------------------------
DROP TABLE IF EXISTS `workflow_runs`;
CREATE TABLE `workflow_runs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `owner_user_id` int NOT NULL,
  `workflow_definition_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `workflow_definition_version` int NULL DEFAULT NULL,
  `overall_status` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `state_version` int NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `paused_at` datetime NULL DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  `cancel_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `cancelled_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_workflow_runs_project_id`(`project_id` ASC) USING BTREE,
  INDEX `ix_workflow_runs_owner_user_id`(`owner_user_id` ASC) USING BTREE,
  INDEX `ix_workflow_runs_definition_key_version`(`workflow_definition_key` ASC, `workflow_definition_version` ASC) USING BTREE,
  CONSTRAINT `workflow_runs_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `workflow_runs_ibfk_2` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_step_attempts
-- ----------------------------
DROP TABLE IF EXISTS `workflow_step_attempts`;
CREATE TABLE `workflow_step_attempts`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempt_no` int NOT NULL,
  `status` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `executor_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `executor_id` int NULL DEFAULT NULL,
  `input_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `output_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `cancel_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  `cancelled_at` datetime NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uq_workflow_step_attempts_run_step_attempt`(`workflow_run_id` ASC, `step_key` ASC, `attempt_no` ASC) USING BTREE,
  INDEX `ix_workflow_step_attempts_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  INDEX `ix_workflow_step_attempts_step_key`(`step_key` ASC) USING BTREE,
  INDEX `ix_workflow_step_attempts_status`(`status` ASC) USING BTREE,
  CONSTRAINT `workflow_step_attempts_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_step_definitions
-- ----------------------------
DROP TABLE IF EXISTS `workflow_step_definitions`;
CREATE TABLE `workflow_step_definitions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_definition_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `step_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `step_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'task',
  `config_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `is_manual_gate` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uq_workflow_step_definitions_def_step`(`workflow_definition_id` ASC, `step_key` ASC) USING BTREE,
  INDEX `ix_workflow_step_definitions_step_key`(`step_key` ASC) USING BTREE,
  CONSTRAINT `workflow_step_definitions_ibfk_1` FOREIGN KEY (`workflow_definition_id`) REFERENCES `workflow_definitions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_step_dependencies
-- ----------------------------
DROP TABLE IF EXISTS `workflow_step_dependencies`;
CREATE TABLE `workflow_step_dependencies`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_definition_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `depends_on_step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `dependency_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'hard',
  `condition_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uq_workflow_step_dependencies_edge`(`workflow_definition_id` ASC, `step_key` ASC, `depends_on_step_key` ASC) USING BTREE,
  INDEX `ix_workflow_step_dependencies_step_key`(`step_key` ASC) USING BTREE,
  INDEX `ix_workflow_step_dependencies_depends_on_step_key`(`depends_on_step_key` ASC) USING BTREE,
  CONSTRAINT `workflow_step_dependencies_ibfk_1` FOREIGN KEY (`workflow_definition_id`) REFERENCES `workflow_definitions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for workflow_step_runs
-- ----------------------------
DROP TABLE IF EXISTS `workflow_step_runs`;
CREATE TABLE `workflow_step_runs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `state_version` int NOT NULL DEFAULT 1,
  `locked_by` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `locked_at` datetime NULL DEFAULT NULL,
  `lease_expires_at` datetime NULL DEFAULT NULL,
  `current_attempt_id` int NULL DEFAULT NULL,
  `attempt_no` int NOT NULL,
  `input_snapshot` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `output_snapshot` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `cancel_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `ready_at` datetime NULL DEFAULT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  `cancelled_at` datetime NULL DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uq_workflow_step_run_key`(`workflow_run_id` ASC, `step_key` ASC) USING BTREE,
  INDEX `ix_workflow_step_runs_step_key`(`step_key` ASC) USING BTREE,
  INDEX `ix_workflow_step_runs_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  INDEX `ix_workflow_step_runs_current_attempt_id`(`current_attempt_id` ASC) USING BTREE,
  CONSTRAINT `workflow_step_runs_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `workflow_step_runs_ibfk_2` FOREIGN KEY (`current_attempt_id`) REFERENCES `workflow_step_attempts` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 13 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

SET FOREIGN_KEY_CHECKS = 1;
