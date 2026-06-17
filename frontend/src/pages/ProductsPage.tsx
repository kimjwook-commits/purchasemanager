import { useEffect, useState, useCallback } from 'react'
import { Table, Tag, Input, Select, Space, Typography, Spin } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { getProducts } from '../api/api'
import type { Product } from '../api/types'

const { Title } = Typography
const { Search } = Input

const TIER_COLORS: Record<string, string> = { cold: 'blue', ambient: 'cyan', room: 'green' }
const TIER_LABELS: Record<string, string> = { cold: '냉장', ambient: '일반', room: '상온' }

export default function ProductsPage() {
  const [data, setData] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tier, setTier] = useState<string | undefined>()
  const [page, setPage] = useState(1)

  const load = useCallback(() => {
    setLoading(true)
    getProducts({ q: q || undefined, tier, page, size: 15 })
      .then(r => { setData(r.data.items); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [q, tier, page])

  useEffect(() => { load() }, [load])

  const handleSearch = (value: string) => { setQ(value); setPage(1) }
  const handleTierChange = (value: string | undefined) => { setTier(value); setPage(1) }

  const columns = [
    { title: '상품 코드', dataIndex: 'product_code', key: 'product_code', width: 100 },
    {
      title: '일본어명', dataIndex: 'name_ja', key: 'name_ja',
      render: (v: string | null) => v || '-',
    },
    {
      title: '온도 티어', dataIndex: 'tier_code', key: 'tier_code', width: 100,
      render: (v: string | null) => v
        ? <Tag color={TIER_COLORS[v] || 'default'}>{TIER_LABELS[v] || v}</Tag>
        : '-',
    },
    {
      title: '양조장', dataIndex: 'brewery_name', key: 'brewery_name',
      render: (v: string | null) => v || '-',
    },
    {
      title: '활성', dataIndex: 'is_active', key: 'is_active', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '활성' : '비활성'}</Tag>,
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>상품 관리</Title>
        <Space>
          <Select
            placeholder="온도 티어"
            allowClear
            style={{ width: 130 }}
            onChange={handleTierChange}
            options={[
              { value: 'cold', label: '냉장' },
              { value: 'ambient', label: '일반' },
              { value: 'room', label: '상온' },
            ]}
          />
          <Search
            placeholder="상품명 검색"
            onSearch={handleSearch}
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
          />
        </Space>
      </div>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="product_id"
        loading={loading}
        size="middle"
        pagination={{
          current: page,
          pageSize: 15,
          total,
          onChange: setPage,
          showTotal: (t) => `총 ${t}개`,
        }}
      />
    </Space>
  )
}
